#include "../src/encoder.h"
#include "xxhash.h"
#include <cstdint>
#include <cstdio>
#include <string>
static int failures;
static void check(bool ok,const char* what) { std::printf("%s %s\n",ok?"ok  ":"FAIL",what); failures+=!ok; }
static std::string hex(const char* text) { std::string out; while(*text) { unsigned v;std::sscanf(text,"%2x",&v);out+=char(v);text+=2; } return out; }
static std::string seal(std::string plain) {
    auto h=XXH32(plain.data(),plain.size(),42);
    for(size_t i=0;i<plain.size();i++)plain[i]=char(uint8_t(plain[i])^uint8_t((h>>(8*(i%4)))+i*41));
    return plain;
}
static void reject(const std::string& b,const char* name,size_t limit=64*1024*1024) {
    std::string out="unchanged";check(!lrm::rsb1_decode(b,out,limit),name);check(out=="unchanged","failure is transactional");
}
int main() {
    // Independent fixture: one raw zstd block containing A NUL B; XXH32
    // calculated with Python xxhash, not rsb1_encode.
    auto golden=hex("00ede604f56248d9b2b3c3801ea98921e20f3487");std::string out;
    check(lrm::rsb1_decode(golden,out) && out==std::string("A\0B",3),"external little-endian RSB1 fixture");
    auto frame=hex("28b52ffd2003190000410042");
    for(size_t n=0;n<golden.size();n++) reject(golden.substr(0,n),"truncation rejected");
    for(size_t i=0;i<golden.size();i++) { auto b=golden;b[i]^=1;reject(b,"single-byte corruption rejected"); }
    reject(seal(std::string("RSB1\xff\xff\xff\xff",8)+frame),"huge claimed size rejected before allocation");
    reject(seal(std::string("RSB1\x02\0\0\0",8)+frame),"claimed size mismatches zstd content size");
    reject(seal(std::string("RSB1\x03\0\0\0",8)+frame+frame),"concatenated frames rejected");
    reject(seal(std::string("RSB1\x03\0\0\0",8)+frame+"x"),"trailing compressed data rejected");
    reject(golden,"caller size limit",2);
    check(lrm::rsb1_decode(golden,out,3),"exact caller size limit accepted");
    for(size_t n:{size_t(0),size_t(1),size_t(255),size_t(65536),size_t(1048576)}) {
        std::string data(n,'\0');for(size_t i=0;i<n;i++)data[i]=char((i*37+i/256)%256);
        auto b=lrm::rsb1_encode(data);check(lrm::rsb1_decode(b,out) && out==data,"binary round trip including NUL/high bytes");
    }
    auto invalid=lrm::compile_client("local = ");
    check(invalid.size()>1 && invalid[0]==0,"compiler errors preserved as binary error messages");
    std::printf("%d failure(s)\n",failures);return failures?1:0;
}
