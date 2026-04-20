const { name, type = "0", rules: rules_file } = $arguments;

// 定义分组类型白名单，只有这些类型的 outbound 才允许追加节点
const GROUP_TYPES = ["selector", "urltest"];

// 定义终端节点类型白名单，用于 Relay 分组的节点筛选
const TERMINAL_TYPES = [
  "vmess", "vless", "trojan", "shadowsocks",
  "shadowsocksr", "hysteria", "hysteria2", "tuic",
  "wireguard", "http", "socks"
];

// 深比较两个对象是否相等（键顺序无关）
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  return keysA.every(k => deepEqual(a[k], b[k]));
}

// 判断某条规则是否已存在于规则列表中
function ruleExists(existingRules, rule) {
  return existingRules.some(r => deepEqual(r, rule));
}

// 1. 读取模板配置
let config = JSON.parse($files[0]);

// 2. 追加自定义规则（如果传了 rules_file 且能成功读取）
if (rules_file) {
  try {
    let customRulesRaw = await produceArtifact({
      type: "file",
      name: rules_file,
    });
    if (customRulesRaw) {
      let customRules = JSON.parse(customRulesRaw);

      // 过滤掉已存在的重复规则（深比较，键顺序无关）
      const deduped = customRules.filter(
        r => !ruleExists(config.route.rules, r)
      );

      // 找到 clash_mode === "global" 规则的索引，插入到其后
      const idx = config.route.rules.findIndex(r => r.clash_mode === "global");
      if (idx !== -1) {
        config.route.rules.splice(idx + 1, 0, ...deduped);
      } else {
        config.route.rules.push(...deduped);
      }
    }
  } catch (e) {
    // 文件不存在、为空或解析失败时静默跳过
  }
}

// 3. 拉取订阅或合集节点
let proxies = await produceArtifact({
  name,
  type: (type === "1" || /col/i.test(type)) ? "collection" : "subscription",
  platform: "sing-box",
  produceType: "internal",
});

// 4. 去重：过滤掉 tag 已存在于 config.outbounds 中的节点
const existingTags = new Set(config.outbounds.map(o => o.tag));
proxies = proxies.filter(p => !existingTags.has(p.tag));

// 5. 将新节点追加到 outbounds
config.outbounds.push(...proxies);

// 6. 准备 tag 列表
//    allTags：所有新节点的 tag
//    terminalTags：属于终端协议类型的节点 tag，用于 Relay 分组
const allTags = proxies.map(p => p.tag);
const terminalTags = proxies
  .filter(p => TERMINAL_TYPES.includes(p.type))
  .map(p => p.tag);

// 7. 遍历 outbounds，向分组追加节点 tag
config.outbounds.forEach(group => {
  // 只处理 selector / urltest 类型，且跳过 Direct-Out
  if (!GROUP_TYPES.includes(group.type) || group.tag === "Direct-Out") return;

  if (group.tag === "Relay") {
    // Relay 分组只追加终端节点（不含链式节点，避免死循环）
    group.outbounds.push(...terminalTags);
  } else {
    // 其他分组追加所有新节点
    group.outbounds.push(...allTags);
  }
});

// 8. 对每个分组的 outbounds 去重，保持顺序
config.outbounds.forEach(group => {
  if (Array.isArray(group.outbounds)) {
    group.outbounds = [...new Set(group.outbounds)];
  }
});

// 9. 输出最终配置
$content = JSON.stringify(config, null, 2);
