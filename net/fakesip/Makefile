include $(TOPDIR)/rules.mk

PKG_NAME:=fakesip
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/killadm/FakeSIP.git
PKG_SOURCE_DATE:=2026-07-22
PKG_SOURCE_VERSION:=54ac813f1fea709e35144239bbe42becbc1eceed
PKG_MIRROR_HASH:=skip

PKG_MAINTAINER:=FakeSIP LuCI feed
PKG_LICENSE:=GPL-3.0-or-later
PKG_LICENSE_FILES:=LICENSE

include $(INCLUDE_DIR)/package.mk

define Package/fakesip
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Firewall
  TITLE:=Disguise UDP traffic as SIP with NFQUEUE
  URL:=https://github.com/MikeWang000000/FakeSIP
  DEPENDS:=+ca-bundle +uclient-fetch +libpthread +libnetfilter-queue +libnfnetlink +libmnl +nftables +kmod-nfnetlink-queue +kmod-nft-queue
endef

define Package/fakesip/description
FakeSIP disguises UDP traffic as SIP-like traffic through Netfilter Queue.
endef

define Package/fakesip/conffiles
/etc/config/fakesip
endef

define Build/Compile
	$(MAKE) -C $(PKG_BUILD_DIR) \
		CC="$(TARGET_CC)" \
		STRIP="$(TARGET_CROSS)strip" \
		CFLAGS="$(TARGET_CFLAGS) $(TARGET_CPPFLAGS)" \
		LDFLAGS="$(TARGET_LDFLAGS)" \
		PREFIX="/usr" \
		VERSION="$(PKG_VERSION)"
endef

define Package/fakesip/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/build/fakesip $(1)/usr/bin/fakesip
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/etc/config/fakesip $(1)/etc/config/fakesip
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/fakesip $(1)/etc/init.d/fakesip
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/etc/uci-defaults/80-fakesip-defaults $(1)/etc/uci-defaults/80-fakesip-defaults
	$(INSTALL_DIR) $(1)/usr/libexec
	$(INSTALL_BIN) ./files/usr/libexec/fakesip-scheduled-restart $(1)/usr/libexec/fakesip-scheduled-restart
	$(INSTALL_BIN) ./files/usr/libexec/fakesip-logread $(1)/usr/libexec/fakesip-logread
	$(INSTALL_BIN) ./files/usr/libexec/fakesip-update $(1)/usr/libexec/fakesip-update
	$(INSTALL_DIR) $(1)/usr/share/fakesip
	$(INSTALL_DATA) ./files/usr/share/fakesip/functions.sh $(1)/usr/share/fakesip/functions.sh
endef

define Package/fakesip/postinst
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] || {
	/etc/init.d/fakesip enable >/dev/null 2>&1 || true
	/etc/init.d/fakesip update_cron >/dev/null 2>&1 || true
}
exit 0
endef

define Package/fakesip/prerm
#!/bin/sh
[ -n "$$IPKG_INSTROOT" ] || {
	/etc/init.d/fakesip stop_now >/dev/null 2>&1 || true
	/etc/init.d/fakesip clear_cron >/dev/null 2>&1 || true
	/etc/init.d/fakesip disable >/dev/null 2>&1 || true
}
exit 0
endef

define Package/fakesip/postrm
#!/bin/sh
rm -rf /var/log/fakesip /var/run/fakesip 2>/dev/null || true
exit 0
endef

$(eval $(call BuildPackage,fakesip))
