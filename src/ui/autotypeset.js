/**
 * 自动排版(2026-11-23 v1.2.0 补全)。
 *
 * 旧实现的「清除行首尾空格 / 合并连续空行」两个选项只计算从未写回文档,
 * 「粘贴时自动应用」也没有接线——面板四个勾选里三个是空转的。本模块把排版规则
 * 做成纯函数 typesetDoc(在给定事务上追加步骤),供「立即执行」与粘贴后自动应用共用。
 *
 * 规则(均不触碰代码块——代码块自身即文本块,块内缩进是代码语义):
 * - emptyParas 删除空段落:无内容或仅空白字符的段落整段删除
 * - mergeBlank 合并连续空行:同级相邻的空段落只留第一个,其余删除
 * - trimSpaces 清除行首尾空格:段落首/尾文本节点两端的空格、制表符、全角空格、nbsp
 *
 * 结构约束:文档至少保留一个块;列表项/任务项的首个段落是 schema 必需子节点
 * (listItem = paragraph block*),这类段落只能清空不能删除。
 * range 给定时只处理落在 [from,to) 内的段落(粘贴场景:只排新贴入的内容)。
 *
 * @param {Transaction} tr
 * @param {{emptyParas?:boolean, mergeBlank?:boolean, trimSpaces?:boolean}} opts
 * @param {{from:number,to:number}|null} range
 * @returns {{removed:number, merged:number, trimmed:number}|null} 无改动返回 null
 */
const WS_ONLY = /^[ \t\u00a0\u3000\ufeff]*$/;
const LEAD = /^[ \t\u00a0\u3000\ufeff]+/;
const TRAIL = /[ \t\u00a0\u3000\ufeff]+$/;
const ITEM_TYPES = ['listItem', 'taskItem'];

function isBlank(p) {
  let blank = true;
  p.forEach((c) => { if (!c.isText || !WS_ONLY.test(c.text || '')) blank = false; });
  return blank;
}

/* 收集全部段落;prevBlank = 同级紧邻的前一个空段落(空行连续性只看同级相邻兄弟)。
   inRange(pos, end):段落区间与给定区间有重叠即算在内——粘贴的首个段落会与光标所在
   段落合并,合并后的段落起点在事务改动区间之外,按"起点落在区间内"判会漏掉它 */
function collect(parent, parentPos, inRange, out) {
  let lastBlank = null;
  parent.forEach((child, offset, index) => {
    const at = parentPos + offset;
    const isPara = child.type.name === 'paragraph';
    const inside = isPara && inRange(at, at + child.nodeSize);
    if (!isPara || !inside) lastBlank = null;
    if (inside) {
      const p = { pos: at, node: child, parent, index, blank: isBlank(child), prevBlank: null };
      if (p.blank) { p.prevBlank = lastBlank; lastBlank = p; }
      out.push(p);
    } else if (child.content.size) {
      collect(child, parentPos + offset + 1, inRange, out);
    }
  });
}

export function typesetDoc(tr, opts, range) {
  const o = opts || {};
  const doc = tr.doc;
  const inRange = range ? (pos, end) => end > range.from && pos < range.to : () => true;
  const paras = [];
  /* 文档内容区起点位置为 0:其直接子节点位置 = offset */
  collect(doc, 0, inRange, paras);
  if (!paras.length) return null;

  const planned = new Map(); /* parent → 已计划删除的子节点数 */
  const ops = []; /* { from, to }:待删除区间(段落整段 / 段内空白) */
  const stats = { removed: 0, merged: 0, trimmed: 0 };
  const clear = (p) => ops.push({ from: p.pos + 1, to: p.pos + 1 + p.node.content.size });
  const drop = (p) => {
    const isItemFirst = ITEM_TYPES.indexOf(p.parent.type.name) >= 0 && p.index === 0;
    const already = planned.get(p.parent) || 0;
    /* 必需子节点与"父节点仅剩这一块"的情况不能删,退化为清空 */
    if (!isItemFirst && p.parent.childCount - already > 1) {
      ops.push({ from: p.pos, to: p.pos + p.node.nodeSize });
      planned.set(p.parent, already + 1);
    } else if (p.node.content.size) clear(p);
    p.gone = true;
  };

  if (o.emptyParas) {
    paras.filter((p) => p.blank).forEach((p) => { drop(p); stats.removed++; });
  } else if (o.mergeBlank) {
    paras.forEach((p) => {
      if (!p.blank) return;
      if (p.prevBlank) { drop(p); stats.merged++; }
      else if (p.node.content.size) clear(p); /* 保留的那个空行清掉空白字符 */
    });
  }

  if (o.trimSpaces) {
    paras.forEach((p) => {
      if (p.gone) return;
      const node = p.node;
      const first = node.firstChild;
      const last = node.lastChild;
      if (!first || !first.isText || !last.isText) return;
      const start = p.pos + 1;
      const end = start + node.content.size;
      const lead = LEAD.exec(first.text || '');
      const tail = TRAIL.exec(last.text || '');
      if (first === last) {
        if (lead && tail && lead[0].length + tail[0].length >= first.text.length) {
          /* 整段皆空白:清空(保持空段落语义,不留空文本节点) */
          ops.push({ from: start, to: end });
          return;
        }
      }
      if (tail && tail[0].length) { ops.push({ from: end - tail[0].length, to: end }); stats.trimmed++; }
      if (lead && lead[0].length) { ops.push({ from: start, to: start + lead[0].length }); stats.trimmed++; }
    });
  }

  if (!ops.length) return null;
  /* 从后往前应用:前面的位置不受影响;被前一个(更靠后的)区间包含的子区间跳过 */
  ops.sort((a, b) => b.from - a.from);
  let coveredFrom = Infinity;
  ops.forEach(({ from, to }) => {
    if (to > coveredFrom) return;
    tr.delete(from, to);
    coveredFrom = from;
  });
  return tr.docChanged ? stats : null;
}

export const TYPESET_DEFAULTS = { emptyParas: true, trimSpaces: true, mergeBlank: true, paste: false };
