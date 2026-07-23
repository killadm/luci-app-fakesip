include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-fakesip
PKG_VERSION:=0.1.0
PKG_RELEASE:=1

PKG_MAINTAINER:=FakeSIP LuCI feed
PKG_LICENSE:=GPL-3.0-or-later

LUCI_TITLE:=LuCI support for FakeSIP
LUCI_DESCRIPTION:=Web interface to configure and monitor FakeSIP traffic obfuscation
LUCI_DEPENDS:=+fakesip
LUCI_PKGARCH:=all

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
