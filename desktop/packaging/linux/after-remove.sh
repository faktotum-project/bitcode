#!/bin/bash
# Debian postrm for bitcode. On upgrade the new postinst re-registers the links
# and the AppArmor profile, so cleanup runs only on a real removal.

case "$1" in
    remove|purge)
        if type update-alternatives >/dev/null 2>&1; then
            update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}' || true
            update-alternatives --remove bitcode '/opt/${sanitizedProductName}/resources/app/dist/bin/bitcode' 2>/dev/null || true
        else
            rm -f '/usr/bin/${executable}'
            [ "$(readlink /usr/bin/bitcode)" = '/opt/${sanitizedProductName}/resources/app/dist/bin/bitcode' ] && rm -f /usr/bin/bitcode
        fi

        if [ -L /opt/Bitcode ] && [ "$(readlink /opt/Bitcode)" = '/opt/${sanitizedProductName}' ]; then
            rm -f /opt/Bitcode
        fi

        PROFILE='/etc/apparmor.d/${executable}'
        if [ -f "$PROFILE" ]; then
            if apparmor_status --enabled >/dev/null 2>&1 && ! { [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
                apparmor_parser --remove "$PROFILE" || true
            fi
            rm -f "$PROFILE"
        fi
        ;;
esac
exit 0
