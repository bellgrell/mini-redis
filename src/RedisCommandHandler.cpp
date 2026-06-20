#include <iostream>
#include <vector>
#include <sstream>
#include <../include/RedisCommandHandler.h>
#include "../include/RedisDatabase.h"
#include <algorithm>

// RESP
//*2\r\n$4\r\n\PING\r\n$4\r\nTEST\r\n
//*2 -> array has two elemants
//$4-> next string has 4 characters
// Ping
// TEST

// if itdoesnt start with '*',fallback to splitting by whitespace
std::vector<std::string> parseRespCommand(const std::string &input)
{
    std::vector<std::string> tokens;
    if (input.empty())
        return tokens;

    if (input[0] != '*')
    {
        std::istringstream iss(input);
        std::string token;
        while (iss >> token)
            tokens.push_back(token);
        return tokens;
    }

    size_t pos = 0;
    // expect '*' followed by number of elements
    if (input[pos] != '*')
        return tokens;
    pos++;

    size_t crlf = input.find("\r\n", pos);
    if (crlf == std::string::npos)
        return tokens;
    int numElements = std::stoi(input.substr(pos, crlf - pos));
    pos = crlf + 2;

    for (int i = 0; i < numElements; i++)
    {
        if (pos >= input.size() || input[pos] != '$')
            break;
        pos++;

        crlf = input.find("\r\n", pos);
        if (crlf == std::string::npos)
            break;
        int len = std::stoi(input.substr(pos, crlf - pos));
        pos = crlf + 2;
        if (pos + len > input.length())
            break;
        std::string token = input.substr(pos, len);
        tokens.push_back(token);
        pos += len + 2;
    }
    return tokens;
}

RedisCommandHandler::RedisCommandHandler() {};

std::string RedisCommandHandler::processCommand(const std::string &commandLine)
{
    // use RESP parser
    auto tokens = parseRespCommand(commandLine);
    if (tokens.empty())
        return "Error : Empty command\r\n";
    for (auto &t : tokens)
    {
        std::cout << t << "\n";
    }
    std::string cmd = tokens[0];
    std::transform(cmd.begin(), cmd.end(), cmd.begin(), ::toupper);
    std::ostringstream response;

    RedisDatabase &db = RedisDatabase::getInstance();

    // check commands
    if (cmd == "PING")
    {
        response << "PONG\r\n";
    }
    else if (cmd == "ECHO")
    {
        if (tokens.size() < 2)
        {
            response << "Error : ECHO requires an argument\r\n";
        }
        else
        {
            response << " + " << tokens[1] << "\r\n";
        }
        //.....cmd of database operations
    }
    else if (cmd == "FLUSHALL")
    {
        db.flushAll();
        response << "OK\r\n";
    }
    // here is the command of common operations
    // there are the key/value operations, list operations and hash operations
    else if (cmd == "SET")
    {
        if (tokens.size() < 3)
        {
            response << "Error : SET requires key and value\r\n";
        }
        else
        {
            db.set(tokens[1], tokens[2]);
            response << "OK\r\n";
        }
    }
    else if (cmd == "GET")
    {
        if (tokens.size() < 2)
        {
            response << "Error : GET requires a key\r\n";
        }
        else
        {
            std::string value;
            if (db.get(tokens[1], value))
            {
                response << "$" << value.size() << "\r\n"
                         << value << "\r\n";
            }
            else
            {
                response << "$-1\r\n"; // key not found
            }
        }
    }
    else if (cmd == "KEYS")
    {
        //std::vector<std::string> allKeys = db.keys();
        auto allKeys = db.keys();
        response << "*" << allKeys.size() << "\r\n";
        for (const auto& key : allKeys)
        {
            response << "$" << key.size() << "\r\n"
                     << key << "\r\n";
        }
    }
    else if (cmd == "TYPE")
    {
        if (tokens.size() < 2)
        {
            response << "Error : TYPE requires a key\r\n";
        }
        else
        {
            response << "+" << db.type(tokens[1]) << "\r\n";
        }
    }
    else if (cmd == "DEL" || cmd == "UNLINK")
    {
        if (tokens.size() < 2)
        {
            response << "Error : DEL requires a key\r\n";
        }
        else
        {
            bool res = db.del(tokens[1]);
            response << ":" << (res ? 1 : 0) << "\r\n";
        }
    }
    else if (cmd == "EXPIRE")
    {
        if (tokens.size() < 3)
        {
            response << "Error : EXPIRE requires a key and seconds\r\n";
        }
        else
        {
            if(db.expire(tokens[1], tokens[2]))
            response << "+OK"  << "\r\n";
        }
    }
    else if (cmd == "RENAME")
    {
        if (tokens.size() < 3)
        {
            response << "Error : RENAME requires old key and new key\r\n";
        }
        else
        {
            if(db.rename(tokens[1], tokens[2]))
            response << "+OK"  << "\r\n";
        }
    }
    else
    {
        response << "Error : Unknown command\r\n";
    }

    return response.str();
}