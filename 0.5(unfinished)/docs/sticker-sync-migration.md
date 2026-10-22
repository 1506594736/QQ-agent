# 表情库同步与收藏策略迁移（231）

本批恢复0.4的QQ收藏发现、收藏开关和小时配额，保留0.5的窄SDK、受控图片读取、严格QQ失败及取消语义。文本转换和切分归227，本文件只描述同步与收藏。

| 原子行为 | 旧版实际路径 | 新版择优 |
| --- | --- | --- |
| 发现已有收藏 | `develop/src/sticker-manager.js:90`的`sync()`读取`fetch_custom_face_detail`，`list()`先同步 | 默认`list_stickers`和提示词都等待选中的`data.stickers.syncFromQQ()`；`all/get/list/buildPromptContext`仍为同步本地读接口 |
| 读取合同 | 旧详情接口返回按count限制的数组 | 新增`qq.emoji-favorites.fetchCustomFaceDetails({limit,signal}) → {entries,complete}`；原`fetchCustomFaces(count)`仍返回URL字符串数组 |
| 合并与删除 | 旧`mergeStickerLibrary`会删除本次未出现的QQ条目 | 默认OneBot详情始终`complete:false`，部分或空响应只增补更新；只有明确完整、当前账号的快照才允许清理未出现的QQ条目，保留manual/ai |
| 本地认知 | 旧版合并保留笔记、标签和计数 | 远端等待后重新读取磁盘，保留较新的本地收藏、笔记、标签、用途、使用计数、本地图片及创建时间；同ID合并为一条，使用唯一临时文件原子提交 |
| 收藏开关与配额 | 旧`collect()`检查开关及滚动一小时次数，新版原先未消费这两项配置 | 在默认数据仓`collectIntoQQ()`中执行，跨聊天串行；图片读取后再次检查保存并重读的配置，排队取消不会迟到执行 |
| QQ结果与索引 | 旧收藏允许部分QQ失败后保留本地记录 | 保留0.5：明确添加失败、缺ID、备注失败、取消不建立成功索引；QQ已添加但索引失败如实返回`indexFailed`；不自动删除QQ收藏来假装回滚 |

## 同步、降级和代际

成功同步缓存60秒；`force:true`跳过TTL，同一代正在进行的请求仍合并。读取数量沿旧版按`promptMaxStickers × 10`限制在1–500，不能据此声称读到了完整收藏库。失败不更新成功缓存时间，也不伪报远端同步成功。

不支持详情、未确认账号、协议/格式错误、断网或写盘失败返回本地缓存及`fromCache:true,degraded:true,code,error`。默认工具会公开降级信息；提示词继续使用本地内容。显式取消可以抛出取消错误。无完整性证明的空响应不会清库。显式宿主`mergeFromQQ()`仍保留原有完整快照语义，不能把它当普通远端读取使用。

每次操作固定选中的owner、provider引用、注册版本、`getAccountIdentity()`返回的非敏感账号代际标记，以及宿主`providerLease`提供的授权receipt。提交前重查同一份receipt；拒绝后重新允许、撤权、同对象重新注册、换账号、停用或停止都不能使旧请求重新有效。SDK只开放具名方法：同步与详情读取要求`data.sessions.read + net.outbound`，添加要求`qq.send + net.outbound`；不借用原始registry或任意文件权限。

## 配额语义

`maxCollectPerHour=0`沿旧公式回退默认10，表示默认额度。负数归1；有限小数按整数次数比较，因此1.2允许2次；非法值及防御性的非有限输入回退10。只有`collectEnabled:false`明确关闭收藏。

配额是当前manager进程内的滚动小时记录，重启会重置。已确认添加立即占额，即使随后备注、取消或本地索引失败；明确添加拒绝或缺ID释放本次额度。网络超时等结果未知的添加保守占用一次尝试额度，并明确说明QQ侧结果未知。

## 默认追加替换与验证

管理员可在`overrides/<层>/composition.json`追加`data.stickers`工厂，替换同步、查询和收藏策略；普通插件通过窄SDK消费。工厂应保留同步本地读接口及异步`syncFromQQ/collectIntoQQ`合同。将该层`enabled:false`后，新应用代恢复修复后的默认实现。231通过真实追加模块验证了工具、提示词、收藏及磁盘效果，未在工具里硬编码替换标记。

本轮实际入口与结果：

- `node test/231-sticker-sync-policy-test.mjs`：56/56，真实默认loader/SDK、OneBot桥、提示词与工具消费、磁盘重读、三阶段取消/代际/撤权、配额、写故障和追加停用恢复；协议及模型边界为进程内桩，禁止socket、DNS、HTTP监听及native进程。
- `node test/22-stickers-test.mjs`：21项通过；85、89完整纯离线回归均exit0。
- 57仅在QA副本执行原A–E断言，exit0；本轮未执行会启动HTTP的E2及后续部分，不能据此声称完整57通过。完整冻结全量结果由root单独记录。

原始失败、最终终态和源码哈希见[231 QA报告](../.qa-local/v04-parity-20261016/sticker231-implementation-core/README.md)。底层OneBot动作可能已产生远端效果，取消保证不继续后续动作或迟到写本地，并不承诺撤销已经提交的QQ操作。
