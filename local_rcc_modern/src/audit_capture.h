#pragma once
#include <cstddef>
#include <filesystem>
#include <string>
namespace lrm {
// Optional diagnostic output only. Never changes the compiler return value.
// Caller supplies a unique numeric/hyphen id; no source text is written.
bool save_compile_capture(const std::filesystem::path& directory, const std::string& id,
                          const std::string& bytecode, const std::string& container,
                          size_t source_size, int target, int options, std::string& error);
}
