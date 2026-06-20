#include "../include/RedisDatabase.h"

#include <mutex>
#include <fstream>
#include <sstream>
#include <string>
#include <unordered_map>
#include <cctype>
#include <algorithm>

RedisDatabase& RedisDatabase::getInstance() {
    static RedisDatabase instance;
    return instance;
};


/*
 memory -> file - dump()
 file -> memory - load()
 k = key value
 l = list 
 h = hash
 
*/
bool RedisDatabase::dump(const std::string& filename) {
    // Implement logic to serialize the database state to a file
    // For simplicity, we can just return true for now
    std::lock_guard<std::mutex> lock(db_mutex);
    std::ofstream ofs(filename, std::ios::binary);
    if (!ofs) return false;
    for(const auto& kv: kv_store) {
        ofs << "k " << kv.first << " " << kv.second << "\n";
    }
    
    for(const auto& kv: list_store){
        ofs << "l " << kv.first << "\n";
        for(const auto& item: kv.second){ 
            ofs << "  " << item ;
            ofs<< "\n";
        }
    }
    for(const auto& kv: hash_store){
        ofs << "h " << kv.first << "\n";
        for(const auto& field_val: kv.second){
            ofs << "  " << field_val.first << " " << field_val.second ;
            ofs<< "\n";
        }
    }
    return true;

}

bool RedisDatabase::load(const std::string& filename) {
    // Implement logic to deserialize the database state from a file
    // For simplicity, we can just return true for nowstd
    std::lock_guard<std::mutex> lock(db_mutex);
    std::ifstream ifs(filename, std::ios::binary);
    if (!ifs) return false;

    kv_store.clear();
    list_store.clear();
    hash_store.clear();

    std::string line;
    while (std::getline(ifs , line)){
        std::istringstream iss(line);
        std::string type;
        iss >> type;
        if(type == "k"){
            std::string key, value;
            iss >> key >> value;
            kv_store[key] = value;
        }
        else if(type == "l"){
            std::string key;
            iss >> key;
            std::vector<std::string> list;
            std::string item;
            while(iss >> item){
                list.push_back(item);
            }
            list_store[key] = list;
        }
        else if(type == "h"){
            std::string key;
            iss >> key;
            std::unordered_map<std::string, std::string> hash;
            std::string pair;
            while(iss >> pair){
                auto pos = pair.find(" : ");
                if(pos != std::string::npos){
                    std::string field = pair.substr(0,pos);
                    std::string value = pair.substr(pos + 3);
                    hash[field] = value;
                }
            }
            hash_store[key] = hash;
        }
    }
    return true;
}

bool RedisDatabase::flushAll() {
    std::lock_guard<std::mutex> lock(db_mutex);
    kv_store.clear();
    list_store.clear();
    hash_store.clear();
    expiry_map.clear();
    return true;
}

void RedisDatabase::set(const std::string& key, const std::string& value) {
    std::lock_guard<std::mutex> lock(db_mutex);
    kv_store[key] = value;
    // remove any expiry if key existed
    expiry_map.erase(key);
}

bool RedisDatabase::get(const std::string& key, std::string& value) {
    std::lock_guard<std::mutex> lock(db_mutex);
    // check expiry first
    auto it = expiry_map.find(key);
    if (it != expiry_map.end()) {
        if (std::chrono::steady_clock::now() >= it->second) {
            kv_store.erase(key);
            expiry_map.erase(it);
            return false;
        }
    }
    auto kv = kv_store.find(key);
    if (kv != kv_store.end()) {
        value = kv->second;
        return true;
    }
    return false;
}

std::vector<std::string> RedisDatabase::keys() {
    std::lock_guard<std::mutex> lock(db_mutex);
    std::vector<std::string> allKeys;
    for (const auto& kv : kv_store) {
        allKeys.push_back(kv.first);
    }
    for (const auto& lv : list_store) {
        allKeys.push_back(lv.first);
    }
    for (const auto& hv : hash_store) {
        allKeys.push_back(hv.first);
    }
    return allKeys;
}

std::string RedisDatabase::type(const std::string& key) {
    std::lock_guard<std::mutex> lock(db_mutex);
    if (kv_store.find(key) != kv_store.end()) return "string";
    if (list_store.find(key) != list_store.end()) return "list";
    if (hash_store.find(key) != hash_store.end()) return "hash";
    return "none";
}

bool RedisDatabase::del(const std::string& key) {
    std::lock_guard<std::mutex> lock(db_mutex);
    bool found = false;
    found |= (kv_store.erase(key) > 0);
    found |= (list_store.erase(key) > 0);
    found |= (hash_store.erase(key) > 0);
    expiry_map.erase(key);
    return found;
}

bool RedisDatabase::expire(const std::string& key, const std::string& seconds) {
    std::lock_guard<std::mutex> lock(db_mutex);
    // only keys that exist in one of the stores can expire
    if (kv_store.find(key) == kv_store.end() &&
        list_store.find(key) == list_store.end() &&
        hash_store.find(key) == hash_store.end()) {
        return false;
    }
    try {
        long sec = std::stol(seconds);
        expiry_map[key] = std::chrono::steady_clock::now() + std::chrono::seconds(sec);
        return true;
    } catch (...) {
        return false;
    }
}

bool RedisDatabase::rename(const std::string& oldKey, const std::string& newKey) {
    std::lock_guard<std::mutex> lock(db_mutex);
    auto kv = kv_store.find(oldKey);
    if (kv != kv_store.end()) {
        kv_store[newKey] = kv->second;
        kv_store.erase(kv);
        // transfer expiry if any
        auto exp = expiry_map.find(oldKey);
        if (exp != expiry_map.end()) {
            expiry_map[newKey] = exp->second;
            expiry_map.erase(exp);
        }
        return true;
    }
    auto lv = list_store.find(oldKey);
    if (lv != list_store.end()) {
        list_store[newKey] = lv->second;
        list_store.erase(lv);
        return true;
    }
    auto hv = hash_store.find(oldKey);
    if (hv != hash_store.end()) {
        hash_store[newKey] = hv->second;
        hash_store.erase(hv);
        return true;
    }
    return false;
}
