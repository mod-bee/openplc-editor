// Drives openplc_retain_weak.cpp's ESP32 store over a fake NVS. Commands run in
// argv order; argv[1] is the NVS file, loaded at start and saved at exit.
//   blob <len> <seed>   fill the working blob     poke <offset> <value>
//   write               openplc_retain_write       flush   openplc_retain_flush
//   read <cap>          openplc_retain_read; prints status, length, whether it equals the blob
//   cut <n>             every write after the next n fails (a power cut)
//   legacy              store the blob as the old single-key record
//   stats               writes and bytes written so far
//   mode                openplc_retain_mode()
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <fstream>

#include "Preferences.h"
#include "openplc_retain.h"

static FakeNvs g_nvs;
FakeNvs &fake_nvs() { return g_nvs; }
unsigned long millis() { return 1000; }

bool Preferences::powered() const { return g_nvs.cut_after < 0 || g_nvs.puts < g_nvs.cut_after; }

bool Preferences::begin(const char *ns, bool readOnly)
{
    ns_ = ns;
    if (readOnly) {
        bool any = false;
        for (auto &kv : g_nvs.keys) any = any || kv.first.compare(0, ns_.size() + 1, ns_ + "/") == 0;
        if (!any) return false;
    }
    open_ = true;
    return true;
}
void Preferences::end() { open_ = false; }
size_t Preferences::getBytesLength(const char *key)
{
    auto it = g_nvs.keys.find(full(key));
    return it == g_nvs.keys.end() ? 0 : it->second.size();
}
size_t Preferences::getBytes(const char *key, void *buf, size_t maxLen)
{
    auto it = g_nvs.keys.find(full(key));
    if (it == g_nvs.keys.end() || it->second.size() > maxLen) return 0;
    memcpy(buf, it->second.data(), it->second.size());
    return it->second.size();
}
size_t Preferences::putBytes(const char *key, const void *value, size_t len)
{
    if (!open_ || !powered()) return 0;
    const uint8_t *p = static_cast<const uint8_t *>(value);
    g_nvs.keys[full(key)] = std::vector<uint8_t>(p, p + len);
    g_nvs.puts++;
    g_nvs.put_bytes += (long)len;
    return len;
}
bool Preferences::isKey(const char *key) { return g_nvs.keys.count(full(key)) != 0; }
bool Preferences::remove(const char *key)
{
    if (!open_ || !powered()) return false;
    return g_nvs.keys.erase(full(key)) != 0;
}

static void load(const char *path)
{
    std::ifstream f(path, std::ios::binary);
    std::string key;
    uint32_t n;
    while (std::getline(f, key, '\0') && f.read(reinterpret_cast<char *>(&n), 4)) {
        std::vector<uint8_t> v(n);
        f.read(reinterpret_cast<char *>(v.data()), n);
        g_nvs.keys[key] = v;
    }
}
static void save(const char *path)
{
    std::ofstream f(path, std::ios::binary | std::ios::trunc);
    for (auto &kv : g_nvs.keys) {
        f.write(kv.first.c_str(), (std::streamsize)kv.first.size() + 1);
        const uint32_t n = (uint32_t)kv.second.size();
        f.write(reinterpret_cast<const char *>(&n), 4);
        f.write(reinterpret_cast<const char *>(kv.second.data()), n);
    }
}

int main(int argc, char **argv)
{
    static uint8_t blob[65535], got[65535];
    uint16_t len = 0;
    load(argv[1]);
    for (int i = 2; i < argc; ++i) {
        const char *c = argv[i];
        if (!strcmp(c, "blob")) {
            len = (uint16_t)atoi(argv[++i]);
            uint32_t x = (uint32_t)atoi(argv[++i]) * 2654435761u + 1u;
            for (uint16_t k = 0; k < len; ++k) {
                x = x * 1103515245u + 12345u;
                blob[k] = (uint8_t)(x >> 16);
            }
        } else if (!strcmp(c, "poke")) {
            const int off = atoi(argv[++i]);
            blob[off] = (uint8_t)atoi(argv[++i]);
        } else if (!strcmp(c, "write")) {
            printf("WRITE %d\n", (int)openplc_retain_write(blob, len));
        } else if (!strcmp(c, "flush")) {
            printf("FLUSH %d\n", (int)openplc_retain_flush());
        } else if (!strcmp(c, "read")) {
            const uint16_t cap = (uint16_t)atoi(argv[++i]);
            uint16_t n = 0;
            const int st = (int)openplc_retain_read("0123456789abcdef0123456789abcdef", 32, got, cap, &n);
            printf("READ %d %u %d\n", st, (unsigned)n, st == 0 && n == len && memcmp(got, blob, len) == 0);
        } else if (!strcmp(c, "cut")) {
            g_nvs.cut_after = g_nvs.puts + atol(argv[++i]);
        } else if (!strcmp(c, "legacy")) {
            g_nvs.keys["oplc_retain/blob"] = std::vector<uint8_t>(blob, blob + len);
        } else if (!strcmp(c, "stats")) {
            printf("STATS %ld %ld %zu\n", g_nvs.puts, g_nvs.put_bytes, g_nvs.keys.size());
        } else if (!strcmp(c, "mode")) {
            printf("MODE %d\n", (int)openplc_retain_mode());
        }
    }
    save(argv[1]);
    return 0;
}
