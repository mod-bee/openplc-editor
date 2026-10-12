// Host stand-in for the ESP32 Arduino Preferences library (NVS): every key in
// memory, saved to a file between runs so each run is one boot. A write is
// atomic, as in NVS; `cut` makes every write after the Nth fail, as a power
// cut would.
#pragma once
#include <stddef.h>
#include <stdint.h>

#include <map>
#include <string>
#include <vector>

unsigned long millis();

struct FakeNvs {
    std::map<std::string, std::vector<uint8_t>> keys;   // "namespace/key"
    long puts = 0;
    long put_bytes = 0;
    long cut_after = -1;   // writes allowed before the power cut; -1: none
};
FakeNvs &fake_nvs();

class Preferences {
public:
    bool begin(const char *ns, bool readOnly = false);
    void end();
    size_t getBytesLength(const char *key);
    size_t getBytes(const char *key, void *buf, size_t maxLen);
    size_t putBytes(const char *key, const void *value, size_t len);
    bool isKey(const char *key);
    bool remove(const char *key);

private:
    std::string full(const char *key) const { return ns_ + "/" + key; }
    bool powered() const;
    std::string ns_;
    bool open_ = false;
};
