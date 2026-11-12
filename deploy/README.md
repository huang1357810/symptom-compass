# 在 CodeArts 里部署

先说结论，避免你在控制台里白找：

> **CodeArts 是 CI/CD 工具链，不是托管平台。** 它负责「拉代码 → 构建 → 把产物推到某个运行环境」，页面最终必须落在 ECS / OBS / 云函数这类真正跑服务的地方。

所以「在 CodeArts 里部署」= 用 CodeArts 流水线，把包推到一个运行环境。本文给两条路，按你的时间选。

| 路线 | 做什么 | 耗时 | 适合 |
| --- | --- | --- | --- |
| **A. 最小合规** | 代码放进 CodeArts Repo，托管仍用云函数 | 10 分钟 | 比赛只要求「使用 CodeArts」 |
| **B. 完整 CI/CD** | Repo → Build 打包 → Deploy 部署到 ECS(Nginx 8080) | 1–2 小时 | 要演示「一条流水线从提交到上线」 |

---

# 路线 A：最小合规（10 分钟）

只做代码托管，部署继续用已经验证过的 FunctionGraph。

1. 打开 **CodeArts → 代码托管 Repo → 新建仓库**（选「普通仓库」，语言选 HTML/JavaScript）
2. 仓库建好后点 **「上传文件」**，把 `site/index.html` 传上去
   - 想传全套：把 `明辨康途-源码.zip` 解压后整体上传（网页端支持拖拽多文件）
3. 提交

完成。评委看到的是「代码托管在华为云 CodeArts」，而线上跑的是华为云 FunctionGraph，两头都是华为云。

---

# 路线 B：完整 CI/CD（推荐，最有说服力）

```
CodeArts Repo（代码）
      │  push
      ▼
CodeArts Build（打 zip 制品）
      │  制品
      ▼
CodeArts Deploy（主机部署 → ECS）
      ▼
Nginx :8080  →  http://<EIP>:8080
```

## B1. 准备一台 ECS

买一台 **2 核 2G、Ubuntu 22.04 或 openEuler 22.03** 的 ECS（按需计费约 0.3–0.5 元/小时），绑定弹性公网 IP。

**安全组放行 8080**（入方向，TCP，源 0.0.0.0/0）。

> 为什么不用 80？国内 ECS 的 80/443 端口要对域名备案后才放行，8080 不受限制，演示完全够用。

SSH 登录后，一次性装好环境：

```bash
# Ubuntu
sudo apt update && sudo apt install -y nginx unzip

# openEuler / CentOS
# sudo yum install -y nginx unzip

sudo systemctl enable nginx && sudo systemctl start nginx
```

把本目录的两个文件传上去（在你自己的电脑上执行）：

```bash
scp deploy/nginx-symptom.conf root@<EIP>:/tmp/
scp deploy/deploy.sh          root@<EIP>:/opt/deploy.sh
```

然后在 ECS 上初始化：

```bash
sudo cp /tmp/nginx-symptom.conf /etc/nginx/conf.d/symptom.conf
sudo rm -f /etc/nginx/conf.d/default.conf    # 避免默认站点占用 80
sudo nginx -t && sudo systemctl reload nginx
```

此时访问 `http://<EIP>:8080` 应该看到 Nginx 默认页或 404，说明服务通了。

## B2. 代码放进 CodeArts Repo

1. **CodeArts → 代码托管 → 新建仓库**，名称如 `symptom-checker`
2. 上传文件：
   - 至少要有 `site/index.html`
   - 建议把 `deploy/` 也传上去（评审时能看到部署脚本，加分）
3. 记下仓库地址，后面构建任务要用

> 网页上传最省事；装了 Git 的话也可以 `git push`。

## B3. 建构建任务（把页面打成 zip）

**CodeArts → 编译构建 → 新建任务**：

| 配置项 | 填什么 |
| --- | --- |
| 任务名称 | `symptom-build` |
| 代码源 | 选 CodeArts Repo，指向 B2 的仓库 |
| 构建环境 | Ubuntu（默认镜像即可） |
| 构建步骤 | 添加「**Shell 命令**」 |

Shell 命令填：

```bash
set -e
mkdir -p out
cp site/index.html out/
cd out
zip -r ../symptom-site.zip .
cd ..
ls -lh symptom-site.zip
```

**产物路径**填：`symptom-site.zip`

保存后点「执行」，日志里出现 `symptom-site.zip` 且体积约 57KB 就成功。

## B4. 建部署应用（推到 ECS）

**CodeArts → 部署 → 新建应用**：

| 配置项 | 填什么 |
| --- | --- |
| 应用名称 | `symptom-deploy` |
| 部署方式 | **主机部署** |

**① 主机组**：新建主机组，添加你的 ECS（填公网 IP、SSH 端口 22、root 账号或密钥）。添加后点「连通性验证」，变绿才能继续。

**② 部署步骤**，按顺序加：

| 步骤 | 配置 |
| --- | --- |
| 下载制品 | 选择 B3 的构建任务产物 `symptom-site.zip` |
| 执行 Shell 命令 | `sudo bash /opt/deploy.sh /tmp/symptom-site.zip` |

> 不同版本的 CodeArts 里，制品可能被下载到 `/tmp` 或某个临时目录。如果脚本找不到包，把 Shell 步骤改成：
> ```bash
> ZIP=$(find /tmp /opt /home -maxdepth 3 -name "symptom-site.zip" 2>/dev/null | head -1)
> echo "artifact=$ZIP"
> sudo bash /opt/deploy.sh "$ZIP"
> ```

保存 → 点「执行部署」。

## B5. 验证

浏览器打开 `http://<EIP>:8080`：

- 看到症状选择页 → 成功
- 勾几个症状 → 查看可能情况 → 右上角显示 **「本地分析」**（ECS 上没有 `/api`，自动回退本地计算，这是预期行为）

如果想把「云端分析」也带上，在 CodeArts 流水线里加一个"部署到 FunctionGraph"的步骤，或者页面继续用 FunctionGraph 的地址——两条链路可以并存。

## B6.（可选）把这些串成流水线

**CodeArts → 流水线 → 新建**：代码源（Repo）→ 构建（B3）→ 部署（B4）。之后每次 push 自动上线，演示时可以现场改一行文案再提交，30 秒后线上生效——这比任何 PPT 都有说服力。

---

# 常见坑

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 打不开 `:8080` | 安全组没放行 | 控制台 → 安全组 → 入方向加 TCP 8080 |
| 502 / Nginx 默认页 | 配置没生效 | `sudo nginx -t` 看报错，`systemctl reload nginx` |
| 403 Forbidden | 目录权限 / SELinux | `chmod -R 755 /var/www/symptom`；`setenforce 0` 临时验证 |
| 部署成功但页面没变 | 浏览器缓存 | Ctrl+F5；配置里已对 index.html 设 no-cache |
| 80 端口访问不了 | 未备案 | 用 8080，或绑定已备案域名 |
| 主机组验证失败 | 密钥/端口/安全组 | 先用 `ssh root@<EIP>` 在本机确认能连 |
| 找不到「下载制品」步骤 | 版本差异 | 改成 Shell 步骤用 `wget` 拉制品地址，或手工 scp |

# 成本

| 资源 | 费用 |
| --- | --- |
| ECS 2C2G 按需 | 约 0.3–0.5 元/小时，演示 10 小时约 3–5 元 |
| EIP 带宽 | 按流量或带宽计费，演示忽略不计 |
| CodeArts | 免费额度足够个人项目 |
| 合计 | **约 5 元以内** |

# 评审证据（截图清单）

1. CodeArts Repo 仓库首页（代码在华为云）
2. Build 任务执行成功的日志（含 `symptom-site.zip`）
3. Deploy 应用执行记录（主机组绿灯 + 部署成功）
4. 流水线全景图（代码 → 构建 → 部署 三段连线）
5. 浏览器打开 `http://<EIP>:8080` 的页面
6. ECS 上 `sudo systemctl status nginx` 的截图

这 6 张图，比在 PPT 里写「使用了华为云」有力得多。
