# Gondolin Documentation

This directory contains additional documentation for Gondolin.

## Guides

- [CLI](./cli.md)
  - Run interactive shells and commands inside a micro-VM
  - Build and verify custom guest images

- [Debug logging](./debug.md)
  - Enable component-scoped debug output via `GONDOLIN_DEBUG` or `sandbox.debug`
  - Intercept debug output using the VM `debugLog` callback

- [Custom images](./custom-images.md)
  - Build custom guest images (kernel/initramfs/rootfs) and configure packages/init scripts

- [Security design](./security.md)
  - Threat model, guarantees, and safe operating envelope

- [Network stack](./network.md)
  - How networking works (HTTP/TLS mediation, policy enforcement, DNS)

- [QEMU](./qemu.md)
  - How Gondolin runs QEMU and how this stays consistent on macOS and Linux

## Other references

- [Host API reference](../host/README.md)
