#include "../src/audit_capture.h"
#include <fstream>
#include <iterator>
#include <iostream>
static std::string read(const std::filesystem::path& p) {
    std::ifstream f(p, std::ios::binary); return {std::istreambuf_iterator<char>(f), {}};
}
int main(int argc, char** argv) {
    if (argc != 2) return 2;
    const std::filesystem::path root=argv[1];std::filesystem::remove_all(root);
    std::string error, bc("a\0\xff",3), rsb("z\0q",3);
    if (!lrm::save_compile_capture(root,"1-2",bc,rsb,8,0,8,error)) return 1;
    if (read(root/"1-2.bc")!=bc || read(root/"1-2.rsb1")!=rsb) return 1;
    if (lrm::save_compile_capture(root,"../outside",bc,rsb,0,0,0,error)) return 1;
    if (lrm::save_compile_capture(root/"1-2.bc"/"bad","3",bc,rsb,0,0,0,error)) return 1;
    std::filesystem::remove_all(root);std::cout<<"binary capture and failure isolation passed\n";
}
