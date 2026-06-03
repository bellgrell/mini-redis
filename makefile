# 编译器与编译参数
CXX := g++
CXXFLAGS := -Wall -g -std=c++11 -I./include   # -I指定头文件目录
LDFLAGS := -pthread                            # 线程库，你代码用到std::thread必须加

# 源文件&目标文件
SRC_DIR := src
OBJ_DIR := obj
BIN := redis_server

# 所有cpp源码
SRCS := $(wildcard $(SRC_DIR)/*.cpp)
# 对应.o目标文件
OBJS := $(patsubst $(SRC_DIR)/%.cpp,$(OBJ_DIR)/%.o,$(SRCS))

# 最终链接规则
$(BIN): $(OBJS)
	$(CXX) $(OBJS) -o $(BIN) $(LDFLAGS)

# 编译cpp生成obj
$(OBJ_DIR)/%.o: $(SRC_DIR)/%.cpp | $(OBJ_DIR)
	$(CXX) $(CXXFLAGS) -c $< -o $@

# 自动创建obj文件夹
$(OBJ_DIR):
	mkdir -p $(OBJ_DIR)

# 清理
clean:
	rm -rf $(OBJ_DIR) $(BIN)

# 伪目标
.PHONY: clean all
all: $(BIN)
