#include <iostream>
using namespace std;

int main()
{
#if __cplusplus >= 201703L
    cout << "当前：C++17及以上, GCC15.2.0编译成功" << endl;
#endif
    return 0;
}