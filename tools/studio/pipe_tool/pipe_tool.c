// Helper for Studio's cross-process notifications (\\.\pipe\RBX_STUDIO_NS-<pid>)
// under Wine. Studio's protocol handler writes the browser-login result to the
// waiting Studio with an asynchronous write and exits at once; under Wine that
// message doesn't get processed. This tool lets the handoff be inspected and
// re-delivered with an ordinary synchronous write.
//   pipe_tool capture            serve \\.\pipe\RBX_STUDIO_NS-<own pid>, print the pid,
//                                then hex-dump what one client writes
//   pipe_tool send <pid> <hex>   write the bytes to \\.\pipe\RBX_STUDIO_NS-<pid>
#include <windows.h>
#include <stdio.h>
#include <string.h>

static int capture(void) {
  char name[64];
  DWORD pid = GetCurrentProcessId();
  snprintf(name, sizeof name, "\\\\.\\pipe\\RBX_STUDIO_NS-%lu", (unsigned long)pid);
  HANDLE h = CreateNamedPipeA(name, PIPE_ACCESS_DUPLEX, PIPE_TYPE_BYTE | PIPE_WAIT, 1, 65536, 65536, 0, NULL);
  if (h == INVALID_HANDLE_VALUE) { fprintf(stderr, "CreateNamedPipe failed %lu\n", GetLastError()); return 1; }
  printf("pid %lu\n", (unsigned long)pid);
  fflush(stdout);
  if (!ConnectNamedPipe(h, NULL) && GetLastError() != ERROR_PIPE_CONNECTED) { fprintf(stderr, "connect failed %lu\n", GetLastError()); return 1; }
  unsigned char buf[65536];
  DWORD total = 0, n;
  while (ReadFile(h, buf + total, sizeof buf - total, &n, NULL) && n) total += n;
  printf("read %lu bytes\n", (unsigned long)total);
  for (DWORD i = 0; i < total; i++) printf("%02x", buf[i]);
  printf("\n");
  return 0;
}

static int send_(const char *pid, const char *hex) {
  char name[64];
  snprintf(name, sizeof name, "\\\\.\\pipe\\RBX_STUDIO_NS-%s", pid);
  size_t len = strlen(hex) / 2;
  unsigned char *data = malloc(len);
  for (size_t i = 0; i < len; i++) sscanf(hex + 2 * i, "%2hhx", &data[i]);
  HANDLE h = INVALID_HANDLE_VALUE;
  for (int t = 0; t < 50 && h == INVALID_HANDLE_VALUE; t++) {
    h = CreateFileA(name, GENERIC_WRITE, 0, NULL, OPEN_EXISTING, 0, NULL);
    if (h == INVALID_HANDLE_VALUE) { WaitNamedPipeA(name, 200); }
  }
  if (h == INVALID_HANDLE_VALUE) { fprintf(stderr, "open %s failed %lu\n", name, GetLastError()); return 1; }
  DWORD n = 0;
  BOOL ok = WriteFile(h, data, (DWORD)len, &n, NULL);
  FlushFileBuffers(h);
  Sleep(1000);  // let the reader take it before the handle closes
  CloseHandle(h);
  printf("%s: wrote %lu of %zu bytes\n", ok ? "ok" : "failed", (unsigned long)n, len);
  return ok ? 0 : 1;
}

int main(int argc, char **argv) {
  if (argc >= 2 && !strcmp(argv[1], "capture")) return capture();
  if (argc >= 4 && !strcmp(argv[1], "send")) return send_(argv[2], argv[3]);
  fprintf(stderr, "usage: pipe_tool capture | pipe_tool send <pid> <hex>\n");
  return 2;
}
