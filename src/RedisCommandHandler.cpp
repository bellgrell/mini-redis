#include <iostream>
#include <vector>
#include <sstream>
#include <../include/RedisCommandHandler.h>
#include <algorithm>

//RESP
//*2\r\n$4\r\n\PING\r\n$4\r\nTEST\r\n
//*2 -> array has two elemants
//$4-> next string has 4 characters
//Ping
//TEST


//if itdoesnt start with '*',fallback to splitting by whitespace
std::vector<std::string> parseRespCommand(const std::string &input){
    std::vector<std::string> tokens;
    if(input.empty()) return tokens;

    if(input[0] != '*'){
        std::istringstream iss(input);
        std::string token;
        while(iss>>token)
            tokens.push_back(token);      
        return tokens;
    }

    size_t pos = 0;
    //expect '*' followed by number of elements
    if(input[pos]!= '*')return tokens;
    pos++;

    size_t crlf = input.find("\r\n", pos);
    if (crlf == std::string::npos)return tokens;
    int numElements = std::stoi(input.substr(pos, crlf - pos));
    pos = crlf + 2;

    for(int i = 0;i<numElements;i++){
        if(pos >= input.size()||input[pos] !='$') break;
        pos++;

        crlf = input.find("\r\n",pos);
        if(crlf == std::string::npos)break;
        int len =  std::stoi(input.substr(pos,crlf - pos));
        pos = crlf + 2;
        if(pos + len > input.length())break;
        std::string token = input.substr(pos,len);
        tokens.push_back(token);
        pos += len + 2;
    }
    return tokens;
}

RedisCommandHandler::RedisCommandHandler(){};

std::string RedisCommandHandler::processCommand(const std::string& commandLine){
    //use RESP parser
    auto tokens = parseRespCommand(commandLine);
    if(tokens.empty())return "Error : Empty command\r\n";
    for(auto& t:tokens){
        std::cout<< t<<"\n";
    }
    std::string cmd = tokens[0];
    std::transform(cmd.begin(), cmd.end(), cmd.begin(), ::toupper);
    std::ostringstream response;

    //connect to database

    //check commands

    return response.str();
}