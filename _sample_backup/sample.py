import os
from collections import *


def add_item(item, bucket=[]):
    bucket.append(item)
    return bucket


def check(value):
    if value == None:
        return False
    if value == True:
        print("got a truthy value")
    try:
        risky()
    except:
        pass
    return type(value) == int


class Widget:
    def render(self):
        return "widget"  # TODO: add real rendering
