"""A minimal stand-in for run_campaign.Run, so the campaign's own browser actions (rc.a_*) drive this walk."""
from common import *


class G:
    def __init__(self, base):
        self.base = base
        self.h, self.fw, self.walk = h, fw, walk
        self.benign = BENIGN
        self.clock_server = None


class R:
    def __init__(self, c, keyboard=False):
        self.c = c
        self.g = G(c.base)
        self.keyboard = keyboard
        self.touch = c.touch
        w, hh = SIZES[c.vp]
        self.size = (w, hh)
        self.alias = {}
        self.remembered = {}
        self.pages = {"main": (c.page, c.events)}

    def page(self, name="main"):
        return self.pages[name][0]

    def url(self, path):
        return self.g.base + path

    def fmt(self, s):
        return s


def row():
    return {"checks": [], "read": [], "timings": {}}
