# gnome-extensions pack crashes when --out-dir does not exist yet, hence the mkdir.
UUID := gclippy@gclippy.local
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
SOURCES := metadata.json extension.js prefs.js lib shell schemas

.PHONY: test smoke schemas install uninstall pack clean

test:
	gjs -m tests/run.js

schemas:
	glib-compile-schemas --strict schemas

install: schemas
	rm -rf $(INSTALL_DIR)
	mkdir -p $(INSTALL_DIR)
	cp -r $(SOURCES) $(INSTALL_DIR)/

uninstall:
	rm -rf $(INSTALL_DIR)

pack:
	mkdir -p dist
	gnome-extensions pack --force --extra-source=lib --extra-source=shell --out-dir=dist .

clean:
	rm -rf dist schemas/gschemas.compiled

smoke:
	tests/smoke.sh
