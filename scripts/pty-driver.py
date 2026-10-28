#!/usr/bin/env python3
"""Minimal pty driver for e2e tests.

Runs a command on a pseudo-terminal, forwarding the parent's stdin/stdout, so a
TUI can be typed at from a normal pipe. Python's stdlib is enough; requiring a
native module (node-pty) to test a terminal keybinding would be a poor trade.
"""

import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

ROWS, COLS = 40, 120


def main() -> int:
    command = sys.argv[1:]
    if not command:
        print("usage: pty-driver.py <command> [args...]", file=sys.stderr)
        return 2

    pid, master = pty.fork()
    if pid == 0:  # child
        try:
            os.execvp(command[0], command)
        finally:
            os._exit(127)

    try:
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))
    except OSError:
        pass

    stdin_fd = sys.stdin.fileno()
    stdout_fd = sys.stdout.fileno()

    def forward_to_child(signum, _frame):
        try:
            os.kill(pid, signum)
        except ProcessLookupError:
            pass

    signal.signal(signal.SIGTERM, forward_to_child)
    signal.signal(signal.SIGINT, forward_to_child)

    watching_stdin = True
    while True:
        try:
            readable, _, _ = select.select([master, stdin_fd] if watching_stdin else [master], [], [], 0.2)
        except InterruptedError:
            continue

        if master in readable:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            if not chunk:
                break
            try:
                os.write(stdout_fd, chunk)
            except OSError:
                break

        if watching_stdin and stdin_fd in readable:
            chunk = os.read(stdin_fd, 65536)
            if not chunk:
                watching_stdin = False
                continue
            try:
                os.write(master, chunk)
            except OSError:
                break

    try:
        _, status = os.waitpid(pid, 0)
    except ChildProcessError:
        status = 0
    return os.waitstatus_to_exitcode(status)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
