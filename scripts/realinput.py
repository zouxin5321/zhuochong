"""真实鼠标注入：用 Win32 mouse_event 在角色窗口中心做单击/双击。

为什么不用 CDP：CDP 的 Input.dispatchMouseEvent 绕过 OS 的窗口激活与鼠标捕获，
会把「真实鼠标下的问题」掩盖掉。这个脚本注入的是系统级输入，和用户手动点击同路。

用法：
  python scripts/realinput.py click
  python scripts/realinput.py double --gap 120
"""
import ctypes
import sys
import time
from ctypes import wintypes as w

u = ctypes.windll.user32
u.SetProcessDPIAware()

MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
WIN_TITLE = "卓宠"


def find_pet_window():
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, w.HWND, w.LPARAM)
    def cb(hwnd, _):
        n = u.GetWindowTextLengthW(hwnd)
        if n:
            buf = ctypes.create_unicode_buffer(n + 1)
            u.GetWindowTextW(hwnd, buf, n + 1)
            if WIN_TITLE in buf.value and u.IsWindowVisible(hwnd):
                rect = w.RECT()
                u.GetWindowRect(hwnd, ctypes.byref(rect))
                found.append(rect)
        return True

    u.EnumWindows(cb, 0)
    return found[0] if found else None


def click():
    u.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    time.sleep(0.03)
    u.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "click"
    gap = 120
    if "--gap" in sys.argv:
        gap = int(sys.argv[sys.argv.index("--gap") + 1])

    rect = find_pet_window()
    if rect is None:
        print("找不到标题含「卓宠」的窗口")
        return 1

    cx = (rect.left + rect.right) // 2
    cy = (rect.top + rect.bottom) // 2

    old = w.POINT()
    u.GetCursorPos(ctypes.byref(old))
    u.SetCursorPos(cx, cy)
    time.sleep(0.15)

    if mode == "double":
        click()
        time.sleep(gap / 1000.0)
        click()
    else:
        click()

    time.sleep(0.12)
    u.SetCursorPos(old.x, old.y)
    print(f"{mode} @ ({cx},{cy}) gap={gap}ms")
    return 0


sys.exit(main())
