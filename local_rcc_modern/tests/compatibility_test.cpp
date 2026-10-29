// Checks serialization against independent compilation and upstream VM loading.
// Only trusted, locally compiled input is passed to the upstream VM.
#include "../src/encoder.h"
#include "Luau/Bytecode.h"
#include "Luau/BytecodeUtils.h"
#include "Luau/Compiler.h"
#include "lua.h"
#include "lualib.h"
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <stdexcept>
#include <string>

static int failures;
static void check(bool ok, const char* label) {
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", label);
    failures += !ok;
}
struct Reader {
    std::string& b; size_t p=0;
    void skip(size_t n) { if (n>b.size()-p) throw std::runtime_error("truncated bytecode"); p+=n; }
    uint8_t u8() { if (p==b.size()) throw std::runtime_error("truncated bytecode"); return uint8_t(b[p++]); }
    uint32_t var() { uint32_t v=0; for(unsigned s=0;s<35;s+=7) { auto x=u8(); if(s==28 && x>15) throw std::runtime_error("varint overflow"); v|=uint32_t(x&127)<<s; if(x<128)return v; } throw std::runtime_error("varint overflow"); }
};
// Version 13 has length-prefixed protos: skip constants/debug info by their
// declared extent, and touch only instruction opcode bytes, never AUX words.
static std::string recover(std::string b, size_t& instructions, size_t& aux) {
    Reader r{b};
    if(r.u8()!=13 || r.u8()!=3) throw std::runtime_error("expected bytecode 13, types 3");
    auto strings=r.var(); for(uint32_t i=0;i<strings;i++) { auto n=r.var(); r.skip(n); }
    while(r.u8()!=0) r.var(); // userdata mappings
    auto protos=r.var();
    for(uint32_t i=0;i<protos;i++) {
        auto n=r.var(); auto start=r.p;
        r.skip(5); auto types=r.var(); r.skip(types);
        auto words=r.var(); auto code=r.p; r.skip(size_t(words)*4);
        for(size_t j=0;j<words;) {
            // 203 is the multiplicative inverse of 227 modulo 256.
            auto op=uint8_t(uint8_t(b[code+j*4])*203);
            if(op>=LOP__COUNT) throw std::runtime_error("invalid recovered opcode");
            auto len=Luau::getOpLength(LuauOpcode(op));
            if(j+len>words) throw std::runtime_error("truncated instruction");
            b[code+j*4]=char(op); instructions++; aux+=len-1; j+=len;
        }
        if(n<b.size()-start && r.p<=start+n) r.p=start+n;
        else throw std::runtime_error("invalid proto extent");
    }
    auto main=r.var(); if(main>=protos || r.p!=b.size()) throw std::runtime_error("invalid main proto or trailing bytes");
    return b;
}
static Luau::CompileOptions options() {
    // Deliberately independent of encoder.cpp: a serialized-byte comparison
    // catches changes to compiler options as well as misplaced opcode writes.
    static const char* globals[]={"game","Game","workspace","Workspace","script","shared","plugin",nullptr};
    Luau::CompileOptions o; o.optimizationLevel=1; o.debugLevel=1;
    o.vectorLib="Vector3";o.vectorCtor="new";o.vectorType="Vector3";o.mutableGlobals=globals;return o;
}
static void test(const char* name,const std::string& src,bool execute=false) {
    auto client=lrm::compile_client(src); size_t ins=0,aux=0;
    auto raw=recover(client,ins,aux);
    auto plain=Luau::compile(src,options());
    check(raw==plain,name);
    auto L=luaL_newstate(); luaL_openlibs(L);
    auto status=luau_load(L,name,raw.data(),raw.size(),0);
    if(status) std::printf("VM: %s\n",lua_tostring(L,-1));
    check(status==0,"recovered bytecode loads in pinned upstream VM");
    if(execute && status==0) {
        check(lua_pcall(L,0,1,0)==0,"recovered bytecode executes");
        check(lua_isnumber(L,-1) && lua_tonumber(L,-1)==42,"execution returns 42");
    }
    lua_close(L);
    std::printf("case=%s version=%u types=%u bytes=%zu instructions=%zu aux=%zu\n",name,uint8_t(client[0]),uint8_t(client[1]),client.size(),ins,aux);
}
int main() {
    test("empty","");
    test("closure/table/loops",R"(
local function sum(t)
 local result=0
 for _,v in ipairs(t) do result+=v end
 return function(n) return result+n end
end
return sum({10,20})(12)
)",true);
    test("imports/aux/vector",R"(
local p=workspace:FindFirstChild('Baseplate')
local v=Vector3.new(1,2,3)
if p then p.Position=v end
return math.max(2,4)
)");
    auto raw=Luau::compile("return 42",options()); auto L=luaL_newstate();
    auto wrong=raw; wrong[0]=char(255);
    check(luau_load(L,"version",wrong.data(),wrong.size(),0)!=0,"unsupported bytecode version rejected");
    check(std::string(lua_tostring(L,-1)).find("bytecode version mismatch")!=std::string::npos,"version failure has distinct diagnostic");
    lua_pop(L,1);wrong=raw;wrong[1]=char(255);
    check(luau_load(L,"types",wrong.data(),wrong.size(),0)!=0,"unsupported type version rejected");
    check(std::string(lua_tostring(L,-1)).find("bytecode type version mismatch")!=std::string::npos,"type failure has distinct diagnostic");
    lua_close(L);
    std::printf("%d failure(s)\n",failures);return failures?1:0;
}
