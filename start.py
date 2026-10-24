#!/usr/bin/env python3
"""
start.py — serve the Waluipedia locally and open its control panel.

The site is static (see README: "Open index.html and it runs"), but opening it
straight off the filesystem breaks the parts that matter most: `fetch()` calls
against `Reputation-Matrix2/data/*.json` are blocked by the browser's CORS rules
on `file://`, so events, characters, props and investigations silently fail to
load. Serving over HTTP fixes that, and this script is the one-command way to do
it.

    python3 start.py                 # serve + the control panel (http://localhost:8765/panel)
    python3 start.py --no-gui        # the plain terminal server (the panel page still answers)
    python3 start.py --port 9000     # pick the port
    python3 start.py --no-browser    # just serve (headless / remote boxes)
    python3 start.py --route "#/article/the_belly_of_the_beast"
    python3 start.py --host 0.0.0.0  # expose on the network / in a container
    python3 start.py --workflow      # also run workflow/server.py (chat + model bridge)
    python3 start.py --no-sheets     # skip the character-sheet suite (tools/sheets-suite.py --watch)
    python3 start.py --foundry-data "C:/Users/me/AppData/Local/FoundryVTT/Data"   # where the suite publishes for Foundry (found automatically otherwise)

The control panel is a page on the site server itself (tools/control-panel.html
at /panel): a switch per thing that can run — the workflow server (chat + LM
Studio bridge), the character-sheet suite (the GM's Foundry export → world
mirror → player sheets at ledger XP → sheets.json + the import packets Foundry
pulls back), the Qwen3-TTS studio (off unless you tick it) — live status lights,
the log, the remembered ticks (~/.waluipedia-start.json), and buttons that
open the other rooms: the site, the chatroom, the sheets, the Waluipedia Hub,
the Token Plate Studio and the NPC Forge (each its own process, launched from
here). The ticked services start when start.py starts, so a double-click on
start.bat brings everything up.

Ctrl-C (or the panel's Shut down) stops it. Nothing is built — this only
serves the repository as it already exists.
"""

from __future__ import annotations

import argparse
import contextlib
import http.server
import json
import os
import socket
import socketserver
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_PORT = 8765
# Files that prove we are pointed at the archive and not a random directory.
LANDMARKS = ("index.html", "Reputation-Matrix2/data/events.json")

# The read-aloud bridge speaks to a local Qwen3-TTS Enhanced Studio (Gradio,
# default http://127.0.0.1:7860 — see docs/QWEN_TTS_BRIDGE.md). On the
# archivist's machine it is started by a batch file in Downloads; if we find
# it, we start it alongside the webserver so both are up in one command.
TTS_BAT_PARTS = ("Downloads", "qw", "Run Qwen3 TTS.bat")
TTS_HOST = "127.0.0.1"
TTS_PORT = 7860
# The workflow server (workflow/server.py): the chatroom's disk saves, the
# archive routes and the bridge to LM Studio. Optional; the static site alone
# is enough to read the archive.
WORKFLOW_SCRIPT = ROOT / "workflow" / "server.py"
WORKFLOW_PORT = 8787
LM_STUDIO_PORT = 1234
# The character-sheet suite (tools/sheets-suite.py --watch): splits a fresh
# Foundry export into the world mirror, keeps player characters on character
# sheets at ledger XP, applies the spoils files, rebuilds data/sheets.json and
# the import packets, and re-runs whenever an export lands. Foundry fetches the
# packets off this server, hence the CORS header on the static handler.
SHEETS_SCRIPT = ROOT / "tools" / "sheets-suite.py"
SHEETS_ROUTE = "#/sheets"
# The Token Plate Studio (tools/token-plate-studio.py): a local page that renders
# full-body token plates through Comfy Desktop's ComfyUI and wires the accepted ones.
PLATES_SCRIPT = ROOT / "tools" / "token-plate-studio.py"
PLATES_PORT = 8766
# The launcher window remembers its ticks here.
PREFS_PATH = Path.home() / ".waluipedia-start.json"



class Handler(http.server.SimpleHTTPRequestHandler):
    """Static handler with the two behaviours the archive needs."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        # The data layer is read at view time. A cached events.json is the
        # classic "I filed it but the page still shows the old one" bug.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        # Foundry (another origin: localhost:30000, a Forge host) fetches the
        # actor packets the sheet suite builds straight off this server.
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def guess_type(self, path):
        # Some minimal Python installs mis-map these, which breaks module
        # loading and the map/portrait layers with no useful error.
        forced = {
            ".js": "text/javascript",
            ".mjs": "text/javascript",
            ".json": "application/json",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".webp": "image/webp",
        }
        ext = os.path.splitext(path)[1].lower()
        return forced.get(ext) or super().guess_type(path)

    def log_message(self, fmt, *args):
        # Default logging prints every portrait and icon. Only surface problems.
        status = str(args[1]) if len(args) > 1 else ""
        if status.startswith(("4", "5")):
            sys.stderr.write("  %s %s\n" % (status, args[0]))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def check_root() -> None:
    missing = [name for name in LANDMARKS if not (ROOT / name).exists()]
    if missing:
        sys.exit(
            "start.py is not sitting in the archive root.\n"
            "  expected here: %s\n"
            "  missing:       %s\n"
            "Keep start.py next to index.html." % (ROOT, ", ".join(missing))
        )


def find_port(host: str, port: int, tries: int = 20) -> int:
    """Return the first free port at or after `port`."""
    for candidate in range(port, port + tries):
        with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind((host, candidate))
                return candidate
            except OSError:
                continue
    sys.exit("No free port in range %d-%d." % (port, port + tries - 1))


# --------------------------------------------------------------------------
# The Qwen3-TTS studio (the read-aloud voice)
# --------------------------------------------------------------------------
def tts_bat_candidates():
    """Where 'Run Qwen3 TTS.bat' might live, best guess first."""
    seen = set()
    homes = [Path.home()]
    # Windows keeps the user profile in USERPROFILE; OneDrive-redirected
    # Downloads folders are common, so cover both roots.
    for var in ("USERPROFILE", "OneDrive"):
        val = os.environ.get(var)
        if val:
            homes.append(Path(val))
    for home in homes:
        bat = home.joinpath(*TTS_BAT_PARTS)
        if str(bat).lower() not in seen:
            seen.add(str(bat).lower())
            yield bat
    # A literal relative path, for the rare cwd-is-home launch.
    bat = Path(*TTS_BAT_PARTS)
    if str(bat).lower() not in seen:
        seen.add(str(bat).lower())
        yield bat


def tts_studio_up() -> bool:
    """Is something already listening on the studio's port?"""
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.settimeout(0.4)
        return sock.connect_ex((TTS_HOST, TTS_PORT)) == 0


# --------------------------------------------------------------------------
# Tailscale: the phone-ready address (see docs/QWEN_TTS_BRIDGE.md)
# --------------------------------------------------------------------------
TS_BIN_CANDIDATES = ("tailscale", r"C:\Program Files\Tailscale\tailscale.exe")


def tailscale_ipv4():
    """This machine's Tailscale address (100.x.y.z), or None.

    The address is what a phone on the same tailnet types into its browser to
    read the archive — and what its read-aloud bridge points at for the voice.
    """
    for binpath in TS_BIN_CANDIDATES:
        try:
            r = subprocess.run([binpath, "ip", "-4"], capture_output=True,
                               text=True, timeout=2.5)
        except Exception:
            continue
        for line in (r.stdout or "").split():
            line = line.strip()
            if line.startswith("100.") and line.count(".") == 3:
                return line
    return None


def lan_ipv4():
    """The address this machine uses to reach the LAN (a UDP socket is
    never actually sent), or None."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("10.255.255.255", 1))
            ip = sock.getsockname()[0]
        finally:
            sock.close()
        # 169.254.x is "no lease" (APIPA): nothing else reaches it either
        return ip if ip and not ip.startswith(("127.", "169.254.")) else None
    except OSError:
        return None


def art_base_for(port: int, host: str, explicit: str = "") -> str:
    """The suite's --art-base, or "" for the default: the art is copied into
    Foundry's Data folder and the packets name it by Data path. Serving the
    art by URL from this server is an opt-in ("auto" = this server's
    Tailscale address, else LAN, else loopback; or a URL) — it needs this
    window open and reachable from every Foundry client whenever Foundry is,
    which is why it is not the default."""
    explicit = (explicit or "").strip()
    if not explicit or explicit.lower() in ("copy", "none", "off"):
        return ""
    if explicit.lower() != "auto":
        return explicit
    if host in ("0.0.0.0", "::"):
        reach = tailscale_ipv4() or lan_ipv4()
        if reach:
            return "http://%s:%d/" % (reach, port)
    return "http://127.0.0.1:%d/" % port


def print_tailnet_tip(port: int, host: str) -> None:
    ts_ip = tailscale_ipv4()
    if not ts_ip:
        return
    print("  tailnet: your Tailscale address is %s" % ts_ip)
    if host in ("0.0.0.0", "::"):
        print("            phones on the tailnet can read the archive at")
        print("            http://%s:%d/" % (ts_ip, port))
        print("            and the chatroom (with --workflow) at")
        print("            http://%s:%d/roleplay" % (ts_ip, WORKFLOW_PORT))
    else:
        print("            re-run with --host 0.0.0.0 and phones on the tailnet")
        print("            can read the archive at http://%s:%d/" % (ts_ip, port))
    print("            read aloud from a phone: open the player bar's gear and")
    print("            point the studio at http://%s:%d" % (ts_ip, TTS_PORT))


def launch_tts_studio(say=print) -> None:
    """Start 'Run Qwen3 TTS.bat' if it exists, so the studio comes up with
    the site. Never raises, never blocks: the webserver starts regardless,
    and a missing bat just means Read aloud needs the studio started by hand.
    """
    if tts_studio_up():
        say("  qwen   : studio already up on %s:%d — not launching again"
            % (TTS_HOST, TTS_PORT))
        return
    bat = next((b for b in tts_bat_candidates() if b.is_file()), None)
    if bat is None:
        say("  qwen   : 'Run Qwen3 TTS.bat' not found (looked in Downloads/qw)")
        say("            read aloud will need the studio started by hand")
        return
    try:
        if os.name == "nt":
            # cmd /c in its own console window: the studio's logs stay
            # visible in a window this script does not own, and the webserver
            # is free to keep going.
            subprocess.Popen(
                ["cmd", "/c", bat.name],
                cwd=str(bat.parent),
                creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0),
                close_fds=True,
            )
        else:
            # Non-Windows box with the bat checked out: report rather than
            # pretending a batch file can run under sh.
            say("  qwen   : found %s but batch files only run on Windows" % bat)
            return
    except Exception as exc:  # a failed launch must not kill the site
        say("  qwen   : could not launch %s (%s)" % (bat, exc))
        say("            read aloud will need the studio started by hand")
        return
    say("  qwen   : launched %s" % bat)
    say("            the studio loads its model first — Read aloud works once")
    say("            it answers on http://%s:%d" % (TTS_HOST, TTS_PORT))


def launch_plate_studio(say=print) -> None:
    """Open the Token Plate Studio (tools/token-plate-studio.py) — see launch_tool."""
    launch_tool("plates", say)


# --------------------------------------------------------------------------
# The workflow server (chat + model bridge), as a child process
# --------------------------------------------------------------------------
def port_open(host: str, port: int, timeout: float = 0.3) -> bool:
    """Is anything answering on host:port right now?"""
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.settimeout(timeout)
        return sock.connect_ex((host, port)) == 0


def launch_workflow(port: int, host: str, lm_url: str = "", say=print):
    """Run workflow/server.py as a child, its lines going to `say`. Returns
    the Popen (or None when it is already up / cannot start)."""
    if port_open("127.0.0.1", port):
        say("  chat   : workflow server already up on %d — not launching again" % port)
        return None
    if not WORKFLOW_SCRIPT.is_file():
        say("  chat   : %s is missing — the chatroom still works from the static page" % WORKFLOW_SCRIPT)
        return None
    env = dict(os.environ)
    env["WORKFLOW_PORT"] = str(port)
    env["WORKFLOW_HOST"] = host or "127.0.0.1"
    if lm_url:
        env["LM_STUDIO_URL"] = lm_url
    env.setdefault("PYTHONUNBUFFERED", "1")
    try:
        proc = subprocess.Popen(
            [sys.executable, str(WORKFLOW_SCRIPT)], cwd=str(ROOT), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
        )
    except Exception as exc:
        say("  chat   : could not start the workflow server (%s)" % exc)
        return None

    def pump():
        try:
            for line in proc.stdout:
                say("  chat   | " + line.rstrip())
        except Exception:
            pass
    threading.Thread(target=pump, daemon=True).start()
    say("  chat   : workflow server starting on http://127.0.0.1:%d/  (chatroom at /roleplay)" % port)
    return proc


def launch_sheets_suite(site_port: int, say=print, foundry_data: str = "", git_sync: bool = False, art_base: str = ""):
    """Run tools/sheets-suite.py --watch as a child, its lines going to `say`.
    `foundry_data` (blank = let the suite find it) is the Foundry Data folder
    the suite publishes packets and the module into — what the Sync button in
    Foundry reads first. `git_sync` adds --git-sync: pull before a pass,
    commit + push the mirror / sheets after, poll GitHub while idle (the
    module and the tools update themselves). `art_base` blank (the default)
    lets the suite copy portraits, tokens and item icons into Data; a URL is
    the opt-in where the packets name the art on this server instead (see
    art_base_for). Returns the Popen (or None when it cannot start)."""
    if not SHEETS_SCRIPT.is_file():
        say("  sheets : %s is missing — the sheets page still serves the committed data/sheets.json" % SHEETS_SCRIPT)
        return None
    env = dict(os.environ)
    env.setdefault("PYTHONUNBUFFERED", "1")
    # Windows gives a piped child cp1252, which cannot spell the suite's "→";
    # the child prints UTF-8 and is read as UTF-8, whatever the code page.
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    try:
        proc = subprocess.Popen(
            [sys.executable, str(SHEETS_SCRIPT), "--watch", "--port", str(site_port)]
            + (["--foundry-data", foundry_data] if foundry_data else []) + (["--git-sync"] if git_sync else [])
            + (["--art-base", art_base] if art_base else []), cwd=str(ROOT), env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding="utf-8", errors="replace", bufsize=1,
        )
    except Exception as exc:
        say("  sheets : could not start the character-sheet suite (%s)" % exc)
        return None

    def pump():
        try:
            for line in proc.stdout:
                say("  sheets | " + line.rstrip())
        except Exception:
            pass
    threading.Thread(target=pump, daemon=True).start()
    say("  sheets : character-sheet suite watching for exports (tools/sheets-suite.py --watch%s); sheets at http://localhost:%d/%s" % (" --git-sync" if git_sync else "", site_port, SHEETS_ROUTE))
    if art_base and art_base.lower() != "copy":
        say("  art    : (opt-in) Foundry's sheets load portraits, tokens and item icons from %s — keep this window open whenever Foundry is%s"
            % (art_base, "" if "127.0.0.1" not in art_base else "; only this machine can reach that address (tick 'reachable from other machines' for players elsewhere)"))
    return proc


def stop_process(proc, say=print) -> None:
    if proc is None or proc.poll() is not None:
        return
    try:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
    except Exception as exc:
        say("  chat   : could not stop the workflow server (%s)" % exc)


# --------------------------------------------------------------------------
# Remembered choices for the window
# --------------------------------------------------------------------------
PREF_DEFAULTS = {
    "site": True, "workflow": True, "sheets": True, "tts": False, "browser": True,
    "port": DEFAULT_PORT, "workflow_port": WORKFLOW_PORT, "expose": False,
    "lm_url": "", "open": "home", "route": "", "foundry_data": "", "git_sync": False, "art_base": "",
    "autostart": True,
}


def load_prefs(path: Path = PREFS_PATH) -> dict:
    prefs = dict(PREF_DEFAULTS)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            for key in PREF_DEFAULTS:
                if key in data and isinstance(data[key], type(PREF_DEFAULTS[key])):
                    prefs[key] = data[key]
    except Exception:
        pass
    return prefs


def save_prefs(prefs: dict, path: Path = PREFS_PATH) -> bool:
    try:
        keep = {k: prefs[k] for k in PREF_DEFAULTS if k in prefs}
        path.write_text(json.dumps(keep, indent=2), encoding="utf-8")
        return True
    except Exception:
        return False


def chat_url(site_port: int, workflow_port: int) -> str:
    """The chatroom: through the workflow server when it answers (disk saves,
    archive routes), the static page otherwise."""
    if port_open("127.0.0.1", workflow_port):
        return "http://127.0.0.1:%d/roleplay" % workflow_port
    return "http://localhost:%d/chatroom.html" % site_port


# --------------------------------------------------------------------------
# The control panel — the start page in the browser (replaces the tkinter window)
# --------------------------------------------------------------------------
PANEL_HTML = ROOT / "tools" / "control-panel.html"
PANEL_ROUTE = "/panel"
HUB_SCRIPT = ROOT / "Reputation-Matrix2" / "tools" / "hub" / "server.py"
HUB_PORT = 8777
FORGE_SCRIPT = ROOT / "tools" / "npc-forge.py"
FORGE_PORT = 8768
LOG_LINES = 2000
# The tools the panel opens in their own process (own console on Windows):
# name → (script, port, label). Each serves its own page and opens it itself.
TOOLS = {
    "plates": (PLATES_SCRIPT, PLATES_PORT, "Token Plate Studio"),
    "forge": (FORGE_SCRIPT, FORGE_PORT, "NPC Forge"),
    "hub": (HUB_SCRIPT, HUB_PORT, "Waluipedia Hub"),
}


def launch_tool(name: str, say=print) -> dict:
    """Open one of TOOLS: if it already answers on its port just open the page,
    otherwise start the script as its own process — it opens the browser
    itself. Never raises; a failed launch must not take the site down."""
    script, port, label = TOOLS[name]
    url = "http://127.0.0.1:%d/" % port
    if port_open("127.0.0.1", port):
        webbrowser.open(url)
        say("  %-6s : %s already up — opened %s" % (name, label, url))
        return {"started": False, "up": True, "url": url}
    if not script.is_file():
        say("  %-6s : %s is missing" % (name, script))
        return {"started": False, "up": False, "error": "%s is missing" % script}
    try:
        subprocess.Popen([sys.executable, str(script)], cwd=str(ROOT),
                         creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0), close_fds=True)
    except Exception as exc:
        say("  %-6s : could not launch %s (%s)" % (name, script, exc))
        return {"started": False, "up": False, "error": str(exc)}
    say("  %-6s : %s starting — it opens %s itself" % (name, label, url))
    if name in ("plates", "forge"):
        say("           (renders go through Comfy Desktop; open it, or press Start Comfy on the page)")
    return {"started": True, "up": False, "url": url}


class Panel:
    """What the window used to hold: the site server, the children (workflow
    server, sheets suite), the remembered ticks and the log — behind a JSON
    API the page at /panel talks to."""

    SERVICES = ("workflow", "sheets", "tts")

    def __init__(self, args):
        self.args = args
        self.saved = load_prefs()          # what the prefs file says
        self.prefs = dict(self.saved)      # what this run uses: the file + the flags
        self.apply_flags(args)
        self.lines = []            # [(seq, text)], trimmed to LOG_LINES
        self.seq = 0
        self.lock = threading.Lock()
        self.httpd = None
        self.thread = None
        self.port = None
        self.host = "127.0.0.1"
        self.children = {"workflow": None, "sheets": None}
        self.exit = threading.Event()

    # ---- flags → prefs (the command line wins over the remembered ticks, once)
    def apply_flags(self, args) -> None:
        p = self.prefs
        if args.port != DEFAULT_PORT:
            p["port"] = args.port
        if args.host == "0.0.0.0":
            p["expose"] = True
        if args.no_browser:
            p["browser"] = False
        if args.no_tts:
            p["tts"] = False
        if args.workflow:
            p["workflow"] = True
        if args.no_sheets:
            p["sheets"] = False
        elif args.sheets:
            p["sheets"] = True
        if args.foundry_data:
            p["foundry_data"] = args.foundry_data
        if args.git_sync:
            p["git_sync"] = True
        if args.art_base:
            p["art_base"] = args.art_base
        if args.route:
            p["open"], p["route"] = "route", args.route
        elif args.page and args.page != "index.html":
            p["open"], p["route"] = "route", args.page

    # ---- the log
    def say(self, text) -> None:
        text = str(text)
        with contextlib.suppress(Exception):
            print(text)
        with self.lock:
            self.seq += 1
            self.lines.append((self.seq, text))
            if len(self.lines) > LOG_LINES:
                del self.lines[: len(self.lines) - LOG_LINES]

    def log_since(self, since: int) -> dict:
        with self.lock:
            lines = [(s, t) for s, t in self.lines if s > since]
            return {"seq": self.seq, "lines": [t for _, t in lines]}

    # ---- the site server (always on: the panel is served by it)
    def start_site(self) -> None:
        host = "0.0.0.0" if self.prefs.get("expose") else "127.0.0.1"
        port = find_port(host, int(self.prefs.get("port") or DEFAULT_PORT))
        handler = make_handler(self)
        self.httpd = Server((host, port), handler)
        self.host, self.port = host, port
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.say("  site   : %s  (serving %s)" % (self.site_url(), ROOT))
        if host == "0.0.0.0":
            self.say("  note   : bound to 0.0.0.0 — reachable from other machines")
        if port != int(self.prefs.get("port") or DEFAULT_PORT):
            self.say("  note   : port %s was busy, using %d" % (self.prefs.get("port"), port))

    def stop_site(self) -> None:
        if self.httpd is not None:
            httpd, self.httpd = self.httpd, None
            httpd.shutdown()
            httpd.server_close()
            self.say("  site   : stopped")

    def restart_site(self, delay: float = 0.5) -> None:
        """Rebind after the reply has gone out (the page reloads itself)."""
        def go():
            time.sleep(delay)
            self.stop_site()
            self.start_site()
        threading.Thread(target=go, daemon=True).start()

    def site_url(self, route: str = "") -> str:
        return "http://localhost:%d/%s" % (self.port or int(self.prefs.get("port") or DEFAULT_PORT), route)

    def panel_url(self) -> str:
        return self.site_url(PANEL_ROUTE.lstrip("/"))

    def home_url(self) -> str:
        p = self.prefs
        if p.get("open") == "route" and p.get("route"):
            r = p["route"]
            return self.site_url(r if r.startswith("#") or r.endswith(".html") else "#" + r.lstrip("#"))
        if p.get("open") == "chat":
            return chat_url(self.port, int(p.get("workflow_port") or WORKFLOW_PORT))
        if p.get("open") == "sheets":
            return self.site_url(SHEETS_ROUTE)
        return self.site_url()

    # ---- the services
    def start(self, name: str) -> dict:
        p = self.prefs
        if name == "workflow":
            if self.alive("workflow"):
                return {"ok": True, "note": "already running"}
            self.children["workflow"] = launch_workflow(int(p.get("workflow_port") or WORKFLOW_PORT), self.host, p.get("lm_url", ""), self.say)
            return {"ok": self.children["workflow"] is not None or port_open("127.0.0.1", int(p.get("workflow_port") or WORKFLOW_PORT))}
        if name == "sheets":
            if self.alive("sheets"):
                return {"ok": True, "note": "already running"}
            self.children["sheets"] = launch_sheets_suite(self.port, self.say, p.get("foundry_data", ""), bool(p.get("git_sync", False)),
                                                          art_base_for(self.port, self.host, p.get("art_base", "")))
            return {"ok": self.children["sheets"] is not None}
        if name == "tts":
            launch_tts_studio(self.say)
            return {"ok": True}
        if name in TOOLS:
            return launch_tool(name, self.say)
        raise KeyError(name)

    def stop(self, name: str) -> dict:
        if name in self.children:
            proc = self.children.get(name)
            if proc is None:
                return {"ok": True, "note": "not started from here"}
            stop_process(proc, self.say)
            self.children[name] = None
            self.say("  %-6s : stopped" % ("chat" if name == "workflow" else name))
            return {"ok": True}
        if name == "tts":
            return {"ok": False, "note": "the TTS studio runs in its own window — close it there"}
        if name in TOOLS:
            return {"ok": False, "note": "%s runs in its own window — close it there" % TOOLS[name][2]}
        raise KeyError(name)

    def alive(self, name: str) -> bool:
        proc = self.children.get(name)
        return proc is not None and proc.poll() is None

    def status(self) -> dict:
        p = self.prefs
        wport = int(p.get("workflow_port") or WORKFLOW_PORT)
        return {
            "site": {"up": self.httpd is not None, "port": self.port, "host": self.host, "url": self.site_url(), "home": self.home_url()},
            "workflow": {"up": port_open("127.0.0.1", wport), "managed": self.alive("workflow"), "port": wport, "url": chat_url(self.port or 0, wport)},
            "sheets": {"up": self.alive("sheets"), "managed": self.alive("sheets"), "url": self.site_url(SHEETS_ROUTE)},
            "tts": {"up": port_open(TTS_HOST, TTS_PORT), "managed": False, "port": TTS_PORT, "url": "http://%s:%d/" % (TTS_HOST, TTS_PORT),
                    "available": any(b.is_file() for b in tts_bat_candidates())},
            "lm": {"up": port_open("127.0.0.1", LM_STUDIO_PORT), "port": LM_STUDIO_PORT},
            **{name: {"up": port_open("127.0.0.1", port), "managed": False, "port": port, "url": "http://127.0.0.1:%d/" % port, "label": label,
                      "available": script.is_file()} for name, (script, port, label) in TOOLS.items()},
        }

    def state(self) -> dict:
        return {"root": str(ROOT), "prefs": self.prefs, "prefs_path": str(PREFS_PATH), "status": self.status(),
                "panel": self.panel_url(), "python": sys.version.split()[0],
                "tailscale": tailscale_ipv4() if self.prefs.get("expose") else None, "lan": lan_ipv4() if self.prefs.get("expose") else None}

    def set_prefs(self, data: dict) -> dict:
        changed = []
        for key, default in PREF_DEFAULTS.items():
            if key not in data:
                continue
            value = data[key]
            if isinstance(default, bool):
                value = bool(value)
            elif isinstance(default, int):
                try:
                    value = int(value)
                except (TypeError, ValueError):
                    continue
            else:
                value = str(value)
            if self.prefs.get(key) != value:
                self.prefs[key] = value
                changed.append(key)
            self.saved[key] = value
        # only the keys the page sent are written: a flag meant for one run
        # (--no-browser, --host 0.0.0.0) never leaks into the file by itself
        ok = save_prefs(self.saved)
        self.say("  prefs  : %s" % (("remembered %s in %s" % (", ".join(changed), PREFS_PATH)) if changed else "nothing changed"))
        rebind = any(k in changed for k in ("port", "expose"))
        if rebind:
            self.say("  site   : rebinding on %s:%s" % ("0.0.0.0" if self.prefs.get("expose") else "127.0.0.1", self.prefs.get("port")))
            self.restart_site()
        return {"ok": ok, "changed": changed, "rebind": rebind, "url": self.panel_url()}

    def autostart(self) -> None:
        p = self.prefs
        if p.get("workflow"):
            self.start("workflow")
        if p.get("sheets"):
            self.start("sheets")
        if p.get("tts"):
            self.start("tts")

    def shutdown(self) -> None:
        for name in ("workflow", "sheets"):
            if self.alive(name):
                self.stop(name)
        # the ticks are remembered by Remember on the panel, never by a flag
        # that was meant for one run (--no-browser, --host 0.0.0.0, …)
        self.exit.set()


def make_handler(panel: "Panel"):
    """The static Handler plus the panel: /panel is the page, /panel/api/* the
    JSON it talks to; everything else is the archive as before."""

    class PanelHandler(Handler):
        def _json(self, code, body):
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _page(self):
            try:
                data = PANEL_HTML.read_bytes()
            except OSError:
                return self._json(404, {"error": "%s is missing" % PANEL_HTML})
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            query = dict(p.split("=", 1) if "=" in p else (p, "") for p in self.path.split("?", 1)[1].split("&")) if "?" in self.path else {}
            if path in (PANEL_ROUTE, PANEL_ROUTE + "/", PANEL_ROUTE + "/index.html"):
                return self._page()
            if path == PANEL_ROUTE + "/api/state":
                return self._json(200, panel.state())
            if path == PANEL_ROUTE + "/api/log":
                try:
                    since = int(query.get("since") or 0)
                except ValueError:
                    since = 0
                return self._json(200, panel.log_since(since))
            return super().do_GET()

        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if not path.startswith(PANEL_ROUTE + "/api/"):
                return self._json(404, {"error": "no route " + path})
            n = int(self.headers.get("Content-Length") or 0)
            try:
                body = json.loads(self.rfile.read(n).decode("utf-8") or "{}") if n else {}
            except ValueError:
                return self._json(400, {"error": "bad JSON"})
            try:
                if path == PANEL_ROUTE + "/api/start":
                    return self._json(200, panel.start(str(body.get("service", ""))))
                if path == PANEL_ROUTE + "/api/stop":
                    return self._json(200, panel.stop(str(body.get("service", ""))))
                if path == PANEL_ROUTE + "/api/prefs":
                    return self._json(200, panel.set_prefs(body if isinstance(body, dict) else {}))
                if path == PANEL_ROUTE + "/api/open":
                    url = str(body.get("url") or "")
                    if not url.startswith(("http://", "https://")):
                        return self._json(400, {"error": "http(s) URLs only"})
                    webbrowser.open(url)
                    return self._json(200, {"ok": True})
                if path == PANEL_ROUTE + "/api/shutdown":
                    self._json(200, {"ok": True, "note": "stopping everything; close this tab"})
                    threading.Thread(target=panel.shutdown, daemon=True).start()
                    return None
                return self._json(404, {"error": "no route " + path})
            except KeyError as exc:
                return self._json(404, {"error": "unknown service %s" % exc})
            except Exception as exc:  # the panel must not take the site down
                return self._json(500, {"error": "%s: %s" % (type(exc).__name__, exc)})

    return PanelHandler


def run_panel(args) -> int:
    """Serve the site, open the control panel, run the remembered ticks, wait."""
    panel = Panel(args)
    panel.say("Waluipedia — The Vigilance Terminal")
    panel.start_site()
    print_tailnet_tip(panel.port, panel.host)
    panel.say("  panel  : %s  (start / stop the workflow server, the sheets suite, the TTS studio; open the tools)" % panel.panel_url())
    panel.say("  stop   : Ctrl-C here, or Shut down on the panel")
    if args.autostart or panel.prefs.get("autostart", True):
        panel.autostart()
    if panel.prefs.get("browser", True):
        def open_browser():
            time.sleep(0.6)
            try:
                if not webbrowser.open(panel.panel_url()):
                    raise webbrowser.Error("no browser")
            except Exception:
                panel.say("  (could not open a browser automatically — visit %s)" % panel.panel_url())
        threading.Thread(target=open_browser, daemon=True).start()
    try:
        while not panel.exit.is_set():
            panel.exit.wait(0.5)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        panel.shutdown()
        panel.stop_site()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Serve the Waluipedia locally and open its control panel in a browser.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Ctrl-C to stop.",
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help="port to serve on (default %d; steps forward if busy)" % DEFAULT_PORT)
    parser.add_argument("--host", default="127.0.0.1",
                        help="interface to bind (default 127.0.0.1; use 0.0.0.0 to expose)")
    parser.add_argument("--route", default="",
                        help='hash route the Home button opens, e.g. "#/article/the_belly_of_the_beast"')
    parser.add_argument("--page", default="index.html",
                        help="page the Home button opens (default index.html)")
    parser.add_argument("--no-browser", action="store_true",
                        help="serve without opening a browser")
    parser.add_argument("--no-tts", action="store_true",
                        help="do not launch the Qwen3-TTS studio batch file "
                             "even if Downloads/qw/Run Qwen3 TTS.bat exists")
    parser.add_argument("--workflow", action="store_true",
                        help="also run workflow/server.py (the chatroom's disk saves, "
                             "archive routes and LM Studio bridge) on %d" % WORKFLOW_PORT)
    parser.add_argument("--workflow-port", type=int, default=WORKFLOW_PORT,
                        help="port for the workflow server (default %d)" % WORKFLOW_PORT)
    sheets = parser.add_mutually_exclusive_group()
    sheets.add_argument("--sheets", action="store_true",
                        help="run the character-sheet suite (tools/sheets-suite.py --watch) — "
                             "the default; the flag only overrides a remembered 'off' tick")
    sheets.add_argument("--no-sheets", action="store_true",
                        help="do not run the character-sheet suite")
    parser.add_argument("--git-sync", action="store_true",
                        help="two-way with GitHub: the sheets suite pulls before a pass, commits and pushes the "
                             "world mirror / sheets after, and polls GitHub while idle so the Mass Import module "
                             "and the tools update themselves (needs a clean checkout with push rights)")
    parser.add_argument("--art-base", default="", metavar="URL",
                        help="opt-in: the address Foundry's sheets load the archive's art from (the sheets suite's --art-base); "
                             "'auto' = this server (the Tailscale or LAN address with --host 0.0.0.0, else http://127.0.0.1:<port>/). "
                             "Default: blank — the suite copies the art into the Foundry Data folder")
    parser.add_argument("--foundry-data", default="", metavar="DIR",
                        help="your Foundry VTT Data folder (…/FoundryVTT/Data); the suite publishes the packets, "
                             "the Mass Import module and the art there so Sync in Foundry needs no URL. "
                             "Blank = the suite finds it (WALUIPEDIA_FOUNDRY_DATA, the usual AppData / "
                             "~/.local/share / Library paths)")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--panel", "--gui", dest="panel", action="store_true",
                      help="open the control panel in the browser (the default; --gui is the old name)")
    mode.add_argument("--no-gui", "--no-panel", dest="no_gui", action="store_true",
                      help="plain terminal mode: serve, print the address, Ctrl-C to stop (the panel page still answers at /panel)")
    parser.add_argument("--autostart", action="store_true",
                        help="(panel) run the remembered ticks on open — the default; kept for old shortcuts")
    args = parser.parse_args()
    with contextlib.suppress(Exception):
        # the address shows up even when piped to a log, and a glyph the
        # terminal's code page lacks (the suite's "→") becomes "?" instead of a crash
        sys.stdout.reconfigure(line_buffering=True, errors="replace")

    check_root()
    if not args.no_gui:
        return run_panel(args)
    port = find_port(args.host, args.port)

    display_host = "localhost" if args.host in ("0.0.0.0", "127.0.0.1", "") else args.host
    url = "http://%s:%d/%s%s" % (display_host, port, args.page, args.route)

    print("Waluipedia — The Vigilance Terminal")
    print("  serving : %s" % ROOT)
    print("  address : %s" % url)
    print("  panel   : http://%s:%d%s" % (display_host, port, PANEL_ROUTE))
    if args.host == "0.0.0.0":
        print("  note    : bound to 0.0.0.0 — reachable from other machines")
    if port != args.port:
        print("  note    : port %d was busy, using %d" % (args.port, port))
    workflow = None
    if args.workflow:
        workflow = launch_workflow(args.workflow_port, args.host)
    sheets_suite = None
    if not args.no_sheets:
        sheets_suite = launch_sheets_suite(port, foundry_data=args.foundry_data, git_sync=bool(args.git_sync),
                                           art_base=art_base_for(port, args.host, args.art_base))
    if not args.no_tts:
        launch_tts_studio()
    print_tailnet_tip(port, args.host)
    print("  stop    : Ctrl-C")
    print()

    if not args.no_browser:
        def open_browser():
            # Give the socket a moment so the first request is not refused.
            time.sleep(0.6)
            try:
                if not webbrowser.open(url):
                    raise webbrowser.Error("no browser")
            except Exception:
                print("  (could not open a browser automatically — "
                      "visit the address above)")
        threading.Thread(target=open_browser, daemon=True).start()

    # terminal mode still answers /panel; the children started here are the
    # panel's to stop, and it can start the rest
    panel = Panel(args)
    panel.children["workflow"], panel.children["sheets"] = workflow, sheets_suite
    try:
        with Server((args.host, port), make_handler(panel)) as httpd:
            panel.httpd, panel.port, panel.host = httpd, port, args.host
            httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        stop_process(workflow)
        stop_process(sheets_suite)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
