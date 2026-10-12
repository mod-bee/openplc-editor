// A board package's own retain store: strong definitions that replace the
// built-in one. VPP_STORE_PERIODIC also defines openplc_retain_mode().
#include "openplc_retain.h"

openplc_retain_status_t openplc_retain_read(const char *, uint16_t, uint8_t *, uint16_t, uint16_t *out_len)
{
    if (out_len) *out_len = 0;
    return OPLC_RETAIN_NO_DATA;
}
openplc_retain_status_t openplc_retain_write(const uint8_t *, uint16_t) { return OPLC_RETAIN_OK; }
openplc_retain_status_t openplc_retain_flush(void) { return OPLC_RETAIN_OK; }
#ifdef VPP_STORE_PERIODIC
openplc_retain_mode_t openplc_retain_mode(void) { return OPLC_RETAIN_MODE_PERIODIC; }
#endif
