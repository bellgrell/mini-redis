#ifndef REDIS_DATABASE_H
#define REDIS_DATABASE_H
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>
#include <chrono>

class RedisDatabase {
public:
//get the singleton instance of the database
    static RedisDatabase& getInstance() ;

// Persistence methods
    bool dump(const std::string& filename);
    bool load(const std::string& filename);

    //common commands
    bool flushAll();

    //kye-value operations
    void set(const std::string& key, const std::string& value);
    bool get(const std::string& key, std::string& value);
    std::vector<std::string> keys();
    std::string type(const std::string& key);
    bool del(const std::string& key);
    //expire
    bool expire(const std::string& key, const std::string& seconds);
    //rename
    bool rename(const std::string& oldKey, const std::string& newKey);


private:
RedisDatabase() = default;
~RedisDatabase() = default;
RedisDatabase(const RedisDatabase&) = delete;
RedisDatabase& operator=(const RedisDatabase&) = delete;

std::mutex db_mutex;
std::unordered_map<std::string, std::string> kv_store;
std::unordered_map<std::string, std::vector<std::string>> list_store;
std::unordered_map<std::string, std::unordered_map<std::string, std::string>> hash_store;

std::unordered_map<std::string, std::chrono::steady_clock::time_point> expiry_map;
};



#endif