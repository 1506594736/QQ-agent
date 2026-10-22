# develop 参考功能补齐记录

2026-10-14。用户明确授权参考 `../develop` 补齐剩余缺口。本批只读必要旧版源码，包括安装、QQ运行时、迁移、模型价格和金句客户端；其中五份主要来源纳入最终散列核对。未读取旧版数据、账号或凭据，未修改旧项目。版本和散列来自历史源码，不声称已重新下载验证供应商的当前文件。

| 功能 | 已实现的本地行为 | 验证与边界 |
|---|---|---|
| 便携运行时安装与锁 | 补 `npm run setup` 与 `npm run setup:check`；QQ 9.9.33.51802、SnowLuma v1.14.19固定版本；可信散列、ZIP路径/大小/CRC校验、原子替换及回滚；程序目录与预留数据目录分开；未知或不符版本、未经验证的 QQ 数据隔离均拒绝启动。 | [147与相关进程验证](../.qa-local/develop-gap-closure-20261014/setup/verification.json)，合成ZIP/程序文件通过。本批历史证据未真实下载、安装或启动QQ；本地复制程序明确不冒充供应商档案散列认证。 |
| SnowLuma配置迁移 | 核对旧/新实际QQ版本及SnowLuma声明，复制到独立目标；拒绝链接、路径逃逸与交叠；保护已用目标；fresh可信安装的未改模板可验证后备份替换，失败回滚。 | [148迁移验证](../.qa-local/develop-gap-closure-20261014/migration/verification.json)，155/155，相关23为57/57。`loginCopied`只表示复制，`loginVerified`仍false，未实测真实账号免扫码。 |
| 价格兜底 | 140条旧版内置历史价，自定义优先；远程/缓存叠加内置价，未命中用全局手填或无价格；显示与实际记账共用查找；非法远程价不破坏缓存；保留已归档成本。 | [146价格验证](../.qa-local/develop-gap-closure-20261014/price/validation.json)，46/46；实际合成旧成本29、新成本281、总310。可见页142条含2条自定义，[当前价与元数据](../.qa-local/develop-gap-closure-20261014/headed-evidence/price-visible-projection.json)。这是2026年9月历史参考快照，未核实当前厂商报价。 |
| 含图金句 | 按旧客户端字段提交内联PNG/JPEG/GIF/WebP；解码预览、明确移除；总计最多9张/图片1MB/JSON 2MB；无原QQ、群号、消息号、图片URL或路径；宿主检查、验证码和提交可取消。 | [149及完整浏览器回归](../.qa-local/develop-gap-closure-20261014/full-regression.log)通过。可见界面合成753字节图片与受控POST散列一致，[形状与散列](../.qa-local/develop-gap-closure-20261014/headed-evidence/quote-image-accepted-shape-and-hash.json)。损坏图片阻止提交，明确移除后保留正文并取消，无新增POST。未真实解决验证码、外站投稿或证明官网存储。 |

插件结构保持原能力注册、transport process provider、社区路由及宿主RPC边界。安装器由用户显式运行；迁移由既有迁移入口调用；图片凭证由宿主管理，不交还面板。就绪栏同时修复了“找到程序但版本不合格仍显示成功”的消费者问题；实际141浏览器红/绿证据分别保留为 [修前](../.qa-local/develop-gap-closure-20261014/readiness-lock-before.log)、[修后](../.qa-local/develop-gap-closure-20261014/readiness-lock-after.log)。

当前 QQ 启动限制：`installedReady` 只表示已发现符合固定版本、且没有失效安装证明的程序；缺少证明的手工安装不视为供应商档案散列认证，安装器总就绪检查仍单独要求有效安装证明。`--user-data-dir` 参数与供应商档案中的 `portable-info.json` 不能证明 QQ 不会使用系统账号目录；目前没有经过真实运行验证的隔离启动方案，因此 `ready` 和 `launchAllowed` 仍为 false，`launchIsolation` 明确为 `unverified`。QQ 单独启动与一键启动暂停，并显示已发现或已安装版本和具体原因；已运行的本实例 QQ 仍可停止。环境变量、设置项或档案中的布尔声明不能解除此限制。安装器保留供应商元数据原件，安装记录与返回提示明确其不构成隔离执行证明。后续须证明真实 QQ 的数据、注册表、进程与系统实例均保持隔离，才能在受维护的启动实现中解除限制。

完整本地回归于2026-10-14 06:14:56 UTC结束，M3 **117/117**、M4 **10/10**，exit0。[结果](../.qa-local/develop-gap-closure-20261014/full-regression-result.json)、[日志](../.qa-local/develop-gap-closure-20261014/full-regression.log)、[源码冻结](../.qa-local/develop-gap-closure-20261014/source-freeze.json)、[最终核对](../.qa-local/develop-gap-closure-20261014/final-verification.json)。初次反证失败和环境spawn EPERM日志均保留，不覆盖历史证据。

新可见验收使用独立合成副本、PROFILE99，生产kernel及IAB界面；HTML仅加入明确标示的离线验证码SDK替身，网络发布由固定合成响应替代。未进行新的Electron/IPC验收、真实QQ/商业模型/社区全链、长跑或安装包构建。原有186行有头清单仍是9通过、92部分通过、84条件不足、1延期，不能把自动回归通过当成186个功能全通过。[逐项清单](headed-qa-checklist.md)。

![可见含图金句预览](../.qa-local/develop-gap-closure-20261014/headed-evidence/quote-image-preview.jpg)
