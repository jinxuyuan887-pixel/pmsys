# GitHub → 阿里云自动发布链路

## 使用方式

1. 在个人功能分支完成开发。
2. 本地运行 `npm run release:check`，并在浏览器完成业务验收。
3. 推送功能分支并创建 Pull Request。
4. PR 的 `quality` 检查通过且审核完成后，合并到 `main`。
5. GitHub 会自动构建不可变 Docker 镜像，并同步到阿里云 ECS。

个人分支不会触发线上部署。`main` 的质量检查失败时，也不会触发部署。

## GitHub 一次性配置

在仓库 `Settings → Environments` 创建 `production` 环境，并在该环境中配置：

| Secret | 说明 |
| --- | --- |
| `ALIYUN_HOST` | ECS 公网 IP，目前为 `8.145.42.85` |
| `ALIYUN_SSH_USER` | 专用发布账号；建议不要长期使用 root |
| `ALIYUN_SSH_PORT` | SSH 端口，留空时使用 `22` |
| `ALIYUN_SSH_PRIVATE_KEY` | GitHub Actions 专用 SSH 私钥 |
| `ALIYUN_SSH_KNOWN_HOSTS` | 经过人工核对的 ECS 主机公钥记录，防止连接到伪造服务器 |

发布账号需要能够：写入 `/opt/pmsys`、执行 Docker、读取 SQLite 数据文件。不要把 SSH 私钥、数据库或附件提交到仓库。

建议继续保持 `main` 分支保护：必须 PR、至少一人审核、`quality` 必须通过、禁止强制推送。

## 数据保护机制

每次发布按以下顺序执行：

1. GitHub 完成测试并构建带 Git SHA 的不可变镜像。
2. ECS 校验当前 SQLite 数据库完整性和核心表记录数。
3. 停止旧容器，阻止发布窗口内继续写入。
4. 使用 SQLite 在线备份能力生成一致性数据库副本，同时打包附件并生成 SHA-256 校验文件。
5. 在数据库副本上执行待应用迁移，并用新镜像完成独立冒烟测试。
6. 副本测试成功后，才对正式数据库执行同一批迁移。
7. 启动新容器，检查容器入口、80 端口网关和数据库完整性。
8. 全部成功后保留旧容器和备份；任何一步失败则自动恢复数据库并启动旧容器。

生产数据始终位于宿主机 `/opt/pmsys/data`，不写入应用镜像：

- SQLite：`/opt/pmsys/data/pmsys.sqlite`
- 附件：`/opt/pmsys/data/files`
- 发布备份：`/opt/pmsys/backups/<版本>-<时间>`

部署脚本只会在发布成功后清理已导入的镜像传输包，不会自动清理历史数据库备份、附件备份、Docker 镜像或旧容器，避免未经确认删除可回退数据。历史发布物需要定期查看磁盘空间，并在人工确认后清理。

## 数据库迁移规则

- 已发布迁移不得修改、重命名或删除。
- 新迁移使用下一个递增编号，例如 `0013_xxx.sql`。
- 禁止在自动迁移中使用 `DROP TABLE`、无条件 `DELETE`、清空或重建真实业务数据。
- 破坏性改动分阶段完成：先新增并兼容，稳定运行后再单独安排数据治理。
- 首次启用链路时，脚本会验证线上数据库确实符合 `0012_acceptance_payment_closure.sql` 基线，验证不通过会停止发布，不会猜测或重放历史迁移。

## 手动重试与查看结果

在 GitHub 仓库的 `Actions → deploy-aliyun` 中可以查看每次发布记录。自动发布失败且问题修复后，可选择 `Run workflow` 手动重试当前 `main`。

线上地址：<http://8.145.42.85/pmsys/>
