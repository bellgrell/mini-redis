#include "../include/RedisServer.h"
#include "../include/RedisCommandHandler.h"
#include "../include/RedisDatabase.h"
#include <iostream>
#include <sys/socket.h>
#include <unistd.h>
#include <netinet/in.h>
#include <vector>
#include <cstring>
#include <thread>
#include <signal.h>


static RedisServer* globalServer = nullptr;

void signalHandler(int signum){
    if(globalServer){
        std::cout<<"Received signal "<<signum<<", shutting down server...\n";
        globalServer->shutdown();
    }
    exit(signum);
}

void RedisServer::setupSignalHandlers(){
    signal(SIGINT, signalHandler);
}

RedisServer::RedisServer(int port):port(port),server_scoket(-1),running(true){
    globalServer = this;
}
void RedisServer::shutdown(){
    running = false;
    if(server_scoket != -1)close(server_scoket);
    std::cout<<"server shutdown";
}

void RedisServer::run(){
    server_scoket = socket(AF_INET, SOCK_STREAM, 0);
    if(server_scoket<0){
        std::cerr<<"error creating server socket";
        return;
    }
    int opt = 1;
    setsockopt(server_scoket, SOL_SOCKET, SO_REUSEADDR, &opt, sizeof(opt));
    sockaddr_in serverAddr{};
    serverAddr.sin_family = AF_INET;
    serverAddr.sin_port = htons(port);
    serverAddr.sin_addr.s_addr = INADDR_ANY;

    if(bind(server_scoket,(struct sockaddr*)&serverAddr,sizeof(serverAddr))<0){
        std::cerr <<"Error Binding Server Socketing\n";
        return;
    }
    std::cout<<"✅ Redis Server 启动成功！监听端口：" << port << std::endl;
    
    if(listen(server_scoket, 10)<0){
        std::cerr<<"Error listening On Server Socket\n";
        return;
    }
    std::cout<<"Redis Server listing ON Port\n";

    std::vector<std::thread> threads;
    RedisCommandHandler cmdHandler;

    while(running){
        int client_socket = accept(server_scoket, nullptr , nullptr);
        if(client_socket < 0){
            std::cerr<< "Error Accepting Client Connection\n";
        break;
        }

        std::cout << "\n👉 新客户端连接：fd = " << client_socket << std::endl;
        threads.emplace_back([client_socket, &cmdHandler](){
            char buffer[1024];
            while(true){
                memset(buffer, 0, sizeof(buffer));
                int bytes = recv(client_socket, buffer, sizeof(buffer) - 1, 0);
                if(bytes <= 0) break;
                std::string request(buffer, bytes);
                std::string response = cmdHandler.processCommand(request);
                send(client_socket, response.c_str(),response.size(),0);
            }
            close(client_socket);
        });
    }

    for(auto& t : threads){
        if(t.joinable()) t.join();
    }
    // before shutdown, save the database
    if(RedisDatabase::getInstance().dump("dump.my_rdb"))
        std::cout<<"✅ Database Dumped Successfully Before Shutdown\n";
    else
        std::cerr<<"Error Dumping Database Before Shutdown\n";

}