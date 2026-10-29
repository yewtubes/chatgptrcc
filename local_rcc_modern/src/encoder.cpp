#include "encoder.h"

#include <cstdint>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <vector>

#include "Luau/BytecodeBuilder.h"
#include "Luau/BytecodeUtils.h"
#include "Luau/Compiler.h"
#include "xxhash.h"
#include "zstd.h"

namespace lrm {
namespace {
struct ClientEncoder : Luau::BytecodeEncoder {
    void encode(uint32_t* data, size_t count) override {
        for (size_t i = 0; i < count;) {
            uint8_t op = LUAU_INSN_OP(data[i]);
            int len = Luau::getOpLength(LuauOpcode(op));
            data[i] = uint8_t(op * 227) | (data[i] & ~0xffu);
            i += len;
        }
    }
};

void xor_key(uint8_t* p, size_t n, uint32_t hash) {
    for (size_t i = 0; i < n; i++) p[i] ^= uint8_t((hash >> (8 * (i % 4))) + i * 41);
}

uint32_t read_le32(const uint8_t* p) {
    return uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24);
}
}  // namespace

std::string compile_client(const std::string& source) {
    static const char* mutable_globals[] = {"game", "Game", "workspace", "Workspace", "script", "shared", "plugin", nullptr};
    Luau::CompileOptions opts;
    opts.optimizationLevel = 1;
    opts.debugLevel = 1;
    opts.vectorLib = "Vector3";
    opts.vectorCtor = "new";
    opts.vectorType = "Vector3";
    opts.mutableGlobals = mutable_globals;
    ClientEncoder enc;
    return Luau::compile(source, opts, {}, &enc);
}

std::string rsb1_encode(const std::string& bytecode) {
    if (bytecode.size() > std::numeric_limits<uint32_t>::max())
        throw std::length_error("RSB1 bytecode exceeds uint32 size");
    size_t cap = ZSTD_compressBound(bytecode.size());
    std::vector<uint8_t> out(8 + cap);
    uint32_t size = uint32_t(bytecode.size());
    std::memcpy(&out[0], "RSB1", 4);
    for (size_t i = 0; i < 4; ++i) out[4 + i] = uint8_t(size >> (8 * i));
    size_t n = ZSTD_compress(&out[8], cap, bytecode.data(), bytecode.size(), ZSTD_maxCLevel());
    if (ZSTD_isError(n)) return {};
    n += 8;
    xor_key(out.data(), n, XXH32(out.data(), n, 42));
    return std::string(reinterpret_cast<char*>(out.data()), n);
}

bool rsb1_decode(const std::string& encoded, std::string& bytecode, size_t max_bytecode_size) {
    if (encoded.size() < 8) return false;
    // The key is derived from the plaintext, so recover it from the known "RSB1" magic.
    std::vector<uint8_t> b(encoded.begin(), encoded.end());
    uint8_t key[4];
    for (int i = 0; i < 4; i++) key[i] = uint8_t((b[i] ^ "RSB1"[i]) - i * 41);
    for (size_t i = 0; i < b.size(); i++) b[i] ^= uint8_t(key[i % 4] + i * 41);
    // XXH32 detects container corruption; it is not a script signature.
    if (XXH32(b.data(), b.size(), 42) != read_le32(key)) return false;
    uint32_t size = read_le32(&b[4]);
    if (size > max_bytecode_size) return false;
    size_t frame_size = ZSTD_findFrameCompressedSize(&b[8], b.size() - 8);
    if (ZSTD_isError(frame_size) || frame_size != b.size() - 8) return false;
    auto content_size = ZSTD_getFrameContentSize(&b[8], b.size() - 8);
    if (content_size == ZSTD_CONTENTSIZE_ERROR ||
        (content_size != ZSTD_CONTENTSIZE_UNKNOWN && content_size != size)) return false;
    std::string decoded(size, '\0');
    size_t n = ZSTD_decompress(decoded.data(), size, &b[8], b.size() - 8);
    if (ZSTD_isError(n) || n != size) return false;
    bytecode.swap(decoded);
    return true;
}
}  // namespace lrm
