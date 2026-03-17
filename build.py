"""Build standalone exe using PyInstaller.

Usage:
    python build.py

Requires: pip install pyinstaller
"""
import PyInstaller.__main__
import os
import sys

# Ensure we run from the script's directory
os.chdir(os.path.dirname(os.path.abspath(__file__)))

PyInstaller.__main__.run([
    'main.py',
    '--name=RadiationFilmAnalysis',
    '--onefile',
    '--windowed',
    '--noconfirm',
    '--clean',
    # Hidden imports that PyInstaller may miss
    '--hidden-import=PIL._tkinter_finder',
    '--hidden-import=scipy.optimize',
    '--hidden-import=numpy',
    '--hidden-import=matplotlib',
    '--hidden-import=matplotlib.backends.backend_tkagg',
])
