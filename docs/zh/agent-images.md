````markdown
# Agent 镜像

Rover 中的 Agent 运行在隔离环境（[沙箱](https://docs.endor.dev/rover/concepts/sandbox/)）中。这些环境使 Agent 能够修改环境来改进、实现、构建、检查和测试给定项目，而不会影响宿主机。Rover 使用 Alpine Linux 作为我们提供的默认沙箱镜像的基础镜像。主要原因是保持这些镜像最小化，并让 Agent 能够访问丰富的包生态系统（`apk`）。

## Agent 镜像

有两种类型的镜像：开发镜像和标签镜像。通常使用开发镜像。标签镜像仅在创建新的 rover 发布版本时使用。

### 基础镜像

基础镜像是 Alpine Linux，因为它非常适合 Agent，体现了开发者友好、占用更少磁盘空间的精神，并且它是为简洁性而构建的。它还有非常丰富的[包支持](https://pkgs.alpinelinux.org/packages)。

基础镜像使用以下 [Dockerfile](../images/agent/Dockerfile) 构建。

#### Agent 安装

通常，当容器内请求新的 agent 会话时，我们使用 `npm install -g` 或 Agent 维护者提供的说明来安装它。

在某些情况下，由于不兼容性，这是不可能的。例如 [Cursor Agent](https://forum.cursor.com/t/cursor-agent-does-not-work-with-non-glibc-based-distributions-such-as-alpine-linux/141571)。对于这些情况，我们有基于 `nix` 的设置（该包也通过 `Dockerfile` 安装）。

通过使用 `nix` 来安装 `cursor-agent`，我们能够拉取兼容的 glibc，并在没有任何问题的情况下使用它。

### 开发镜像

`main` 分支上的代码指向 `ghcr.io/endorhq/rover/agent-dev:latest`。当新的提交推送到 `main` 分支时，自动化会构建并推送到此镜像。

### 标签镜像

每当我们在 Rover 中创建新标签时，一个带有该标签名称的新镜像将被推送到：`ghcr.io/endorhq/rover/agent:<tag>`。

请注意，标签镜像命名为 `agent`，而开发镜像命名为 `agent-dev`。这样当新标签推送到 `ghcr.io/endorhq/rover/agent` 镜像时，`ghcr.io/endorhq/rover/agent-dev:latest` 镜像不会受到影响。

#### 发布

通过 [Release 工作流](../.github/workflows/release.yml) 发布镜像的新标签。此工作流将标记源代码，并构建新的 agent 镜像，同时更新源代码指向该 agent 镜像。

## 开发新的 Agent 镜像

某些更改可能需要在开发期间更新容器中运行的 `rover-agent` CLI，或者我们可能想更新基础镜像或对其进行一些更改。在这种情况下，必须构建新的 `rover-agent` 镜像。

### 最低镜像要求

如果你正在尝试构建与当前镜像非常不同的 agent 镜像，镜像的最低要求如下。

#### Node

无论你使用什么基础镜像，Node 24 都是先决条件，因为 [`rover-agent`](https://github.com/endorhq/rover/tree/main/packages/agent) 是一个 Node 应用程序。

#### Package Manager MCP

[package-manager MCP](https://github.com/endorhq/package-manager-mcp) 是一个静态二进制文件，允许配置的 agent 在容器中搜索和安装包。

期望在 `$PATH` 中存在一个名为 `package-manager-mcp-server` 的二进制文件。它将在 agent 设置阶段进行配置。

你可以在[发布列表](https://github.com/endorhq/package-manager-mcp/releases)中找到静态二进制文件。

#### 保留目录

保留目录可能存在也可能不存在于容器镜像中。但是，它们的原始内容在 Agent 执行期间将不可用，因为 Rover 会自动将宿主机路径挂载到这些目录中。

- `/workspace`：用于用户项目的挂载点。

- `/output`：Rover 用于跟踪任务进度的挂载点。

#### Sudo

系统中需要有 `sudo` 可用。这个决定背后的原因是我们需要在无人值守模式下运行 Agent，以便它们可以完成任务而无需询问许多中间问题。但是，通常在容器内，我们被识别为 `root` 用户。如果是超级用户，许多 agent 会拒绝运行，所以我们使用非特权用户运行 agent，并与之一起使用 `sudo`。

在无根容器中，我们也使用 `sudo`。

Rover agent CLI 经历两个主要步骤：

1. 设置环境并安装系统依赖
2. 运行选定的 agent

理想情况下，应该有两个 `sudo` 配置文件：

- `/etc/sudoers.d/1-agent-setup`
- `/etc/sudoers.d/2-agent-cleanup`

这些文件的内容将取决于基础镜像中为 Rover 配置的默认组。但是，一个好的经验法则是从基础镜像获取 `/etc/group` 并相应地配置两者，添加一个额外的组 `agent`，如有必要，Rover 将自动创建该组。

Rover 将在将控制权交给 agent 之前删除 `/etc/sudoers.d/1-agent-setup`。从那时起，
`/etc/sudoers.d/2-agent-cleanup` 将决定 agent 能够用 `sudo` 做什么：强烈建议减少可以在没有密码的情况下以 root 权限执行的命令列表。

以下是 `node:24-alpine` 的示例：

<details>

<summary>/etc/sudoers.d/1-agent-setup</summary>

```
# Rover agent 组；如果容器内没有与宿主机 gid 匹配的 gid，
# 将使用 `agent` 组。

%agent ALL=(ALL) NOPASSWD: ALL

# /etc/group 中的原始镜像组列表。如果宿主机用户 gid
# 与其中任何一个匹配，它将能够在容器内正常使用 `sudo`。

%root ALL=(ALL) NOPASSWD: ALL
%bin ALL=(ALL) NOPASSWD: ALL
%daemon ALL=(ALL) NOPASSWD: ALL
%sys ALL=(ALL) NOPASSWD: ALL
%adm ALL=(ALL) NOPASSWD: ALL
%tty ALL=(ALL) NOPASSWD: ALL
%disk ALL=(ALL) NOPASSWD: ALL
%lp ALL=(ALL) NOPASSWD: ALL
%kmem ALL=(ALL) NOPASSWD: ALL
%wheel ALL=(ALL) NOPASSWD: ALL
%floppy ALL=(ALL) NOPASSWD: ALL
%mail ALL=(ALL) NOPASSWD: ALL
%news ALL=(ALL) NOPASSWD: ALL
%uucp ALL=(ALL) NOPASSWD: ALL
%cron ALL=(ALL) NOPASSWD: ALL
%audio ALL=(ALL) NOPASSWD: ALL
%cdrom ALL=(ALL) NOPASSWD: ALL
%dialout ALL=(ALL) NOPASSWD: ALL
%ftp ALL=(ALL) NOPASSWD: ALL
%sshd ALL=(ALL) NOPASSWD: ALL
%input ALL=(ALL) NOPASSWD: ALL
%tape ALL=(ALL) NOPASSWD: ALL
%video ALL=(ALL) NOPASSWD: ALL
%netdev ALL=(ALL) NOPASSWD: ALL
%kvm ALL=(ALL) NOPASSWD: ALL
%games ALL=(ALL) NOPASSWD: ALL
%shadow ALL=(ALL) NOPASSWD: ALL
%www-data ALL=(ALL) NOPASSWD: ALL
%users ALL=(ALL) NOPASSWD: ALL
%ntp ALL=(ALL) NOPASSWD: ALL
%abuild ALL=(ALL) NOPASSWD: ALL
%utmp ALL=(ALL) NOPASSWD: ALL
%ping ALL=(ALL) NOPASSWD: ALL
%nogroup ALL=(ALL) NOPASSWD: ALL
%nobody ALL=(ALL) NOPASSWD: ALL
%node ALL=(ALL) NOPASSWD: ALL
%nix ALL=(ALL) NOPASSWD: ALL
%nixbld ALL=(ALL) NOPASSWD: ALL
```

</details>

<details>

<summary>/etc/sudoers.d/2-agent-cleanup</summary>

```
# Rover agent 组；如果容器内没有与宿主机 gid 匹配的 gid，
# 将使用 `agent` 组。

%agent ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee

# /etc/group 中的原始镜像组列表。如果宿主机用户 gid
# 与其中任何一个匹配，它将能够在容器内正常使用 `sudo`。

%root ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%bin ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%daemon ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%sys ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%adm ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%tty ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%disk ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%lp ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%kmem ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%wheel ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%floppy ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%mail ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%news ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%uucp ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%cron ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%audio ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%cdrom ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%dialout ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%ftp ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%sshd ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%input ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%tape ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%video ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%netdev ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%kvm ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%games ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%shadow ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%www-data ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%users ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%ntp ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%abuild ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%utmp ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%ping ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%nogroup ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%nobody ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%node ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%nix ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
%nixbld ALL=(ALL) NOPASSWD: /bin/chown,/bin/cp,/bin/mv,/usr/bin/tee
```

</details>

````
