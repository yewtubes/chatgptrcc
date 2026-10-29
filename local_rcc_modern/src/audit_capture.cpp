#include "audit_capture.h"
#include <fstream>
#include <stdexcept>
namespace lrm {
namespace {
void write(const std::filesystem::path& path, const std::string& data) {
    std::ofstream f(path, std::ios::binary);
    f.write(data.data(), data.size());
    f.close();
    if (!f) throw std::runtime_error("capture write failed");
}
}
bool save_compile_capture(const std::filesystem::path& directory, const std::string& id,
                          const std::string& bytecode, const std::string& container,
                          size_t source_size, int target, int options, std::string& error) {
    try {
        if (id.empty() || id.find_first_not_of("0123456789-") != std::string::npos)
            throw std::runtime_error("invalid capture id");
        std::filesystem::create_directories(directory);
        write(directory / (id + ".bc"), bytecode);
        write(directory / (id + ".rsb1"), container);
        write(directory / (id + ".json"), "{\"source_size\":" + std::to_string(source_size) +
              ",\"bytecode_size\":" + std::to_string(bytecode.size()) +
              ",\"container_size\":" + std::to_string(container.size()) +
              ",\"target\":" + std::to_string(target) + ",\"options\":" + std::to_string(options) + "}\n");
        error.clear(); return true;
    } catch (const std::exception& e) { error = e.what(); return false; }
}
}
