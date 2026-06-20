#include <iostream>
#include "../include/RedisServer.h"
#include "../include/RedisCommandHandler.h"
#include "../include/RedisDatabase.h"
#include <thread>
#include <chrono>

int main(int argc, char* argv[]){

    int port = 6379;
    if(argc >= 2 )port = std::stoi(argv[1]);

    RedisServer server(port);

    //backfround persistance:dump the database erery 300 seconds.(5*60 save database)
    std::thread persistanceThread([](){
        while(true){
            std::this_thread::sleep_for(std::chrono::seconds(300));
            //dump the database
            if(!RedisDatabase::getInstance().dump("dump.my_rdb"))
                std::cerr<<"Error Dumping Database\n";
            else
                std::cout<<"✅ Database Dumped Successfully\n";
            
        }
    });

    persistanceThread.detach();
    server.run();
    


    return 0;
}