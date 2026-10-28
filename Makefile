# gnome-extensions pack crashes when --out-dir does not exist yet, hence the mkdir.
UUID := gclipy@gobaz.github.io
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SOURCES := metadata.json extension.js prefs.js lib shell schemas

.PHONY: test smoke screenshot schemas install enable uninstall pack clean

test:
	gjs -m tests/run.js

schemas:
	glib-compile-schemas --strict schemas

install: schemas
	rm -rf $(INSTALL_DIR)
	mkdir -p $(INSTALL_DIR)
	cp -r $(SOURCES) $(INSTALL_DIR)/

# Installs, restarts GNOME Shell (X11) and enables the extension.
enable: install
	tools/enable.sh $(UUID)

uninstall:
	rm -rf $(INSTALL_DIR)

pack:
	mkdir -p dist
	gnome-extensions pack --force --extra-source=lib --extra-source=shell --out-dir=dist .

clean:
	rm -rf dist schemas/gschemas.compiled

smoke:
	tests/smoke.sh

screenshot:
	mkdir -p docs
	SCREENSHOT_DIR=$(CURDIR)/docs tests/smoke.sh screenshot
