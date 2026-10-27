#!/bin/bash
# Debian postinst for bitcode. electron-builder fills in the quoted paths and
# treats every dollar-brace as a macro, so shell variables use plain $NAME.

APP_DIR='/opt/${sanitizedProductName}'
DESKTOP_BIN="$APP_DIR/${executable}"
CLI_BIN="$APP_DIR/resources/app/dist/bin/bitcode"

link_command() {
    if type update-alternatives >/dev/null 2>&1; then
        update-alternatives --install "/usr/bin/$1" "$1" "$2" 100 || ln -sf "$2" "/usr/bin/$1"
    else
        ln -sf "$2" "/usr/bin/$1"
    fi
}

# The desktop link replaces an older plain symlink of this package.
if [ -L '/usr/bin/${executable}' ] && [ "$(readlink '/usr/bin/${executable}')" != '/etc/alternatives/${executable}' ]; then
    rm -f '/usr/bin/${executable}'
fi
link_command '${executable}' "$DESKTOP_BIN"

# /usr/bin/bitcode may belong to another installation of the CLI: it is linked
# only when absent or already managed through alternatives, never replaced.
chmod 0755 "$CLI_BIN" || true
if { [ ! -e /usr/bin/bitcode ] && [ ! -L /usr/bin/bitcode ]; } || [ "$(readlink /usr/bin/bitcode)" = /etc/alternatives/bitcode ]; then
    link_command bitcode "$CLI_BIN"
else
    echo "bitcode: /usr/bin/bitcode belongs to another installation; the bundled CLI stays at $CLI_BIN"
fi

# The menu entry starts the app through the /usr/bin link, which follows the
# install directory; electron-builder can only write the absolute binary path.
sed -i 's|^Exec="\{0,1\}/opt/[^"]*/${executable}"\{0,1\}|Exec=/usr/bin/${executable}|' '/usr/share/applications/${executable}.desktop' || true

# Desktop 0.2 lived in /opt/Bitcode. Menus, pinned launchers and autostart
# entries cached from it keep working through this link to the current path.
LEGACY_DIR=/opt/Bitcode
if [ "$APP_DIR" != "$LEGACY_DIR" ] && [ ! -e "$LEGACY_DIR" ] && [ ! -L "$LEGACY_DIR" ]; then
    ln -s "$APP_DIR" "$LEGACY_DIR" || true
fi

# chrome-sandbox needs SUID only where unprivileged user namespaces are unavailable.
if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; }; then
    chmod 4755 "$APP_DIR/chrome-sandbox" || true
else
    chmod 0755 "$APP_DIR/chrome-sandbox" || true
fi

if hash update-mime-database 2>/dev/null; then update-mime-database /usr/share/mime || true; fi
if hash update-desktop-database 2>/dev/null; then update-desktop-database /usr/share/applications || true; fi
if hash gtk-update-icon-cache 2>/dev/null; then gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true; fi

# Ubuntu 24.04+ restricts unprivileged user namespaces through AppArmor. The
# profile is installed only when the running AppArmor accepts its abi/4.0 syntax.
if apparmor_status --enabled >/dev/null 2>&1; then
    PROFILE_SOURCE="$APP_DIR/resources/apparmor-profile"
    PROFILE_TARGET='/etc/apparmor.d/${executable}'
    if apparmor_parser --skip-kernel-load --debug "$PROFILE_SOURCE" >/dev/null 2>&1; then
        cp -f "$PROFILE_SOURCE" "$PROFILE_TARGET"
        if ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
            apparmor_parser --replace --write-cache --skip-read-cache "$PROFILE_TARGET"
        fi
    else
        echo "bitcode: this AppArmor version does not support the bundled profile; skipping it"
    fi
fi
exit 0
