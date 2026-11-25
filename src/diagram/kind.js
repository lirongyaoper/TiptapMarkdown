/**
 * 画板图型识别与起始模板(v1.3.0)。纯函数。
 * 编辑器与前台共用一份 Mermaid,这里只回答"这段源码是哪一类图",决定画板块给出哪种编辑形态。
 */
const KINDS = [
  ['flow', /^(graph|flowchart)\b/i, '流程图'],
  ['mind', /^mindmap\b/i, '思维导图'],
  ['sequence', /^sequenceDiagram\b/i, '时序图'],
  ['class', /^classDiagram\b/i, '类图'],
  ['state', /^stateDiagram(-v2)?\b/i, '状态图'],
  ['gantt', /^gantt\b/i, '甘特图'],
  ['pie', /^pie\b/i, '饼图'],
  ['er', /^erDiagram\b/i, 'ER 图'],
  ['journey', /^journey\b/i, '用户旅程图'],
  ['timeline', /^timeline\b/i, '时间线'],
  ['gitgraph', /^gitGraph\b/i, 'Git 图'],
  ['requirement', /^requirementDiagram\b/i, '需求图'],
  ['c4', /^C4(Context|Container|Component|Dynamic|Deployment)\b/i, 'C4 图'],
  ['quadrant', /^quadrantChart\b/i, '象限图'],
  ['xy', /^xychart-beta\b/i, '图表'],
  ['block', /^block-beta\b/i, '块图'],
  ['architecture', /^architecture(-beta)?\b/i, '架构图'],
  ['kanban', /^kanban\b/i, '看板'],
  ['packet', /^packet(-beta)?\b/i, '网络包图'],
  ['radar', /^radar-beta\b/i, '雷达图'],
  ['sankey', /^sankey-beta\b/i, '桑基图'],
  ['treemap', /^treemap-beta\b/i, '树图'],
  ['mindmap', /^mindmap\b/i, '思维导图']
];

/** 去掉 frontmatter、指令/注释行与首尾空白后的第一句,用于判型 */
function firstStatement(src) {
  const lines = String(src || '').split(/\r\n?|\n/);
  let i = 0;
  /* YAML frontmatter:--- … --- */
  if (lines[0] && lines[0].trim() === '---') {
    for (i = 1; i < lines.length; i++) if (lines[i].trim() === '---') break;
    i++;
  }
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t.indexOf('%%') === 0) continue;
    return t;
  }
  return '';
}

/**
 * @returns {{kind:string,label:string}|null}  空源码返回 null
 */
export function detectKind(src) {
  const head = firstStatement(src);
  if (!head) return null;
  const hit = KINDS.find(([, re]) => re.test(head));
  return hit ? { kind: hit[0], label: hit[2] } : { kind: 'other', label: '图表' };
}

/** 可视化编辑(在图上直接增删改)支持的图型;其余只有「源码 + 实时预览」 */
export const VISUAL_KINDS = ['flow', 'mind', 'class'];

export const STARTER = {
  flow: 'graph TD\n  A([开始]) --> B[处理步骤]\n  B --> C{判断?}\n  C -->|是| D([结束])\n  C -->|否| B',
  mind: 'mindmap\n  root(中心主题)\n    分支一\n      要点 1\n      要点 2\n    分支二\n      要点 1',
  /* 类图:属性 / 方法 / 构造型 / 带基数与文字的聚合 / 实现,各来一样 */
  class: [
    'classDiagram',
    '  class 文章 {',
    '    +String 标题',
    '    +int 浏览量',
    '    +发布() void',
    '  }',
    '  class 评论 {',
    '    +String 内容',
    '  }',
    '  class 可审核 {',
    '    <<interface>>',
    '    +审核() bool',
    '  }',
    '  文章 "1" o-- "*" 评论 : 收到',
    '  评论 ..|> 可审核'
  ].join('\n')
};

/** 各图型的空白起点(画板块「新建」时用)。空流程图 Mermaid 可渲染;空类图只有头行会解析失败,带上一条 direction 才行;
 *  思维导图至少要有根节点 */
export const BLANK = {
  flow: 'graph TD',
  mind: 'mindmap\n  root(中心主题)',
  class: 'classDiagram\ndirection TB'
};
