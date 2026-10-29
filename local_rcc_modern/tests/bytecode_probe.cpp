// Offline diagnostic tool. Does not load Roblox or modify any client binary.
#include "../src/encoder.h"
#include <cstdint>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#include <string>
static std::string read(const char* name) {
    std::ifstream f(name,std::ios::binary);
    if(!f) throw std::runtime_error(std::string("cannot open ")+name);
    return {std::istreambuf_iterator<char>(f),{}};
}
static void write(const std::string& name,const std::string& data) {
    std::ofstream f(name,std::ios::binary);f.write(data.data(),data.size());
    if(!f)throw std::runtime_error("cannot write "+name);
}
int main(int argc,char** argv) {
    try {
        if(argc!=4)throw std::runtime_error("usage: bytecode_probe compile source.lua output-prefix | decode container.rsb1 output.bc");
        auto input=read(argv[2]);std::string mode=argv[1];
        if(mode=="compile") {
            auto bc=lrm::compile_client(input);
            if(bc.empty() || bc[0]==0)throw std::runtime_error(bc.empty()?"empty compiler result":bc.substr(1));
            auto packed=lrm::rsb1_encode(bc);if(packed.empty())throw std::runtime_error("compression failed");
            write(std::string(argv[3])+".bc",bc);write(std::string(argv[3])+".rsb1",packed);
            std::cout<<"source="<<input.size()<<" bytecode="<<bc.size()<<" version="<<unsigned(uint8_t(bc[0]))
                     <<" types="<<unsigned(uint8_t(bc[1]))<<" rsb1="<<packed.size()<<"\n";
        } else if(mode=="decode") {
            std::string bc;if(!lrm::rsb1_decode(input,bc))throw std::runtime_error("invalid or oversized RSB1 container");
            write(argv[3],bc);std::cout<<"decoded="<<bc.size()<<"\n";
        } else throw std::runtime_error("unknown mode");
    }catch(const std::exception& e) {std::cerr<<e.what()<<"\n";return 1;}
}
