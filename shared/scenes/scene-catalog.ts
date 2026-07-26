export interface SceneCatalogEntry {
  id: number;
  name: string;
  description: string;
  category: string;
  imageUrl: string;
  sourceUrl: string;
}

export const sceneCatalog: readonly SceneCatalogEntry[] = [
  {
    id: 1,
    name: "纯灰背景",
    description: "中性冰川灰纯色背景，适合通用产品展示与后期合成。",
    category: "纯色背景",
    imageUrl: "/scenes/01.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/temp/material/10000002/10000002/2026-07-23/2d8d42ff1de8766430a0c75828443e63.jpg",
  },
  {
    id: 2,
    name: "纯黑背景",
    description: "深黑纯色背景，适合突出高对比度商品与高端材质。",
    category: "纯色背景",
    imageUrl: "/scenes/02.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/temp/material/10000002/10000002/2026-07-23/357fb8c481bd6e97ed40eb4eb4c7bc30.jpg",
  },
  {
    id: 3,
    name: "纯白背景",
    description: "无元素纯白底图，适合全品类商品主图与抠图使用。",
    category: "纯色背景",
    imageUrl: "/scenes/03.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/temp/material/10000002/10000002/2026-07-23/e5117654ed9a5371c2cc969c5976628f.jpg",
  },
  {
    id: 4,
    name: "自然玻璃展示台",
    description: "石材台面、玻璃屏风与植物光影构成自然感展示背景。",
    category: "产品展台",
    imageUrl: "/scenes/04.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/119fc33a50cda4f430bb00da34a32c13.jpeg",
  },
  {
    id: 5,
    name: "奶油拱门展示台",
    description: "奶油色拱门与白色台座形成柔和高级的陈列空间。",
    category: "产品展台",
    imageUrl: "/scenes/05.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/706858db93a3c5b00c8fb892c9aa1616.jpeg",
  },
  {
    id: 6,
    name: "粉色玫瑰展示台",
    description: "粉色玫瑰、珍珠与白色圆台组成甜美的产品展示背景。",
    category: "产品展台",
    imageUrl: "/scenes/06.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/7ef80bd9e2830b61c60ecce719ff7544.jpeg",
  },
  {
    id: 7,
    name: "水光渐变展示台",
    description: "透明玻璃台置于水波与玻璃摆件之间，画面清透梦幻。",
    category: "产品展台",
    imageUrl: "/scenes/07.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/f2d90ed91f6d7b4d464e4c7e8c60de4c.jpeg",
  },
  {
    id: 8,
    name: "自然展示台",
    description: "原木小桌与周围绿植形成柔和自然的展示角落。",
    category: "产品展台",
    imageUrl: "/scenes/08.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/d4c4681d14f171009404b62fb734a2aa.jpeg",
  },
  {
    id: 9,
    name: "自然森林",
    description: "林间小路延伸至远处，适合自然、户外与养生主题。",
    category: "自然户外",
    imageUrl: "/scenes/09.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/4e301983c6bc0e1131d2711ceefc688f.jpeg",
  },
  {
    id: 10,
    name: "法式花园",
    description: "花丛、藤椅和庭院小径组成自然浪漫的花园背景。",
    category: "自然户外",
    imageUrl: "/scenes/10.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/457641ee8260c207b8dbf72e4d553165.jpeg",
  },
  {
    id: 11,
    name: "草坪野餐",
    description: "平整绿地和白色围栏营造明亮的田园野餐场景。",
    category: "自然户外",
    imageUrl: "/scenes/11.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/c3473134fad2e020d15406f4ce56f3e6.jpeg",
  },
  {
    id: 12,
    name: "海边沙滩",
    description: "浅色沙滩、清澈海水与大面积天空构成清爽海滨背景。",
    category: "自然户外",
    imageUrl: "/scenes/12.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/c9905d92486031cfd4ccf0990f82d947.jpeg",
  },
  {
    id: 13,
    name: "公园广场",
    description: "树荫步道与绿地形成舒适的城市公园场景。",
    category: "自然户外",
    imageUrl: "/scenes/13.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/65933f7daebe45160515301198dfd15e.jpeg",
  },
  {
    id: 14,
    name: "商业步行街",
    description: "两侧商铺与开阔步道构成干净的城市街景背景。",
    category: "自然户外",
    imageUrl: "/scenes/14.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/8391ec7c9e39943d59962113da134a92.jpeg",
  },
  {
    id: 15,
    name: "现代办公室",
    description: "玻璃隔断、办公桌和绿植构成明亮现代的办公背景。",
    category: "办公空间",
    imageUrl: "/scenes/15.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/69bdade608356b7e18d19185ca9d29b7.jpeg",
  },
  {
    id: 16,
    name: "温馨酒店客房",
    description: "浅木家具和柔软床品打造温暖的酒店客房氛围。",
    category: "酒店空间",
    imageUrl: "/scenes/16.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/d6fa86a974513a1827197d4efcc3ce3f.jpeg",
  },
  {
    id: 17,
    name: "现代酒店客房",
    description: "大床、窗边休闲椅与城市景观呈现现代酒店客房。",
    category: "酒店空间",
    imageUrl: "/scenes/17.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/01862f09053e51b27828f95ce9df76cb.jpeg",
  },
  {
    id: 18,
    name: "瑜伽馆",
    description: "镜面墙、瑜伽垫和木地板组成安静舒缓的运动场景。",
    category: "运动健康",
    imageUrl: "/scenes/18.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/88b94f0e36e30254a92b571b30da789e.jpeg",
  },
  {
    id: 19,
    name: "健身房",
    description: "力量器械、镜墙和黑色地垫构成专业健身空间。",
    category: "运动健康",
    imageUrl: "/scenes/19.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/d2490983ffdec526bbc955f106815f2e.jpeg",
  },
  {
    id: 20,
    name: "现代美妆店",
    description: "整齐的护肤和彩妆陈列架，适合美妆零售类背景。",
    category: "商业空间",
    imageUrl: "/scenes/20.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/92d6bcea2528e0daaf1b7a9de6d9ee18.jpeg",
  },
  {
    id: 21,
    name: "轻奢服装店",
    description: "衣架、展示墙和前台构成明亮的女装店铺场景。",
    category: "商业空间",
    imageUrl: "/scenes/21.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/0b45b82137a473cd122cfd3daac76de4.jpeg",
  },
  {
    id: 22,
    name: "现代服装店",
    description: "浅色陈列台与服装挂架形成简洁的服饰零售空间。",
    category: "商业空间",
    imageUrl: "/scenes/22.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/34d1ebd67d38a1f5503cdee89aa51247.jpeg",
  },
  {
    id: 23,
    name: "欧式餐厅",
    description: "宽敞的木质餐桌与自然采光，适合餐饮类背景使用。",
    category: "商业空间",
    imageUrl: "/scenes/23.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/6659c51ce4a46e89086b5146e5594795.jpeg",
  },
  {
    id: 24,
    name: "复古咖啡馆",
    description: "木质餐桌、旧式陈列柜与吊灯营造复古咖啡馆氛围。",
    category: "商业空间",
    imageUrl: "/scenes/24.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/2a2ad53a2bce3ec26c5d8f912dba573f.jpeg",
  },
  {
    id: 25,
    name: "咖啡馆",
    description: "木质吧台、浅色桌椅和咖啡设备呈现明亮咖啡馆场景。",
    category: "商业空间",
    imageUrl: "/scenes/25.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/40c8d7863ce3a3ce8dc8fc598d345e8f.jpeg",
  },
  {
    id: 26,
    name: "占卜桌",
    description: "木质桌面与毛毡配合暖色顶灯，适合玄学口播和珠宝展示。",
    category: "商业空间",
    imageUrl: "/scenes/26.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-21/77985d2ff0e0cd16382634217639bb89.jpeg",
  },
  {
    id: 27,
    name: "酒店大堂",
    description: "雕花墙面、柔粉窗帘与浅色软装营造温柔法式氛围。",
    category: "酒店空间",
    imageUrl: "/scenes/27.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/bd628808cca9ff2893fd5565d3abe301.jpeg",
  },
  {
    id: 28,
    name: "轻奢客厅·白色",
    description: "白色沙发、弧形灯带和木质柜面营造轻奢氛围。",
    category: "居家空间",
    imageUrl: "/scenes/28.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-22/c018b4da630701adb71e67c9f27c5b51.jpeg",
  },
  {
    id: 29,
    name: "精致客厅-暗色",
    description: "灰色沙发和暗色背景墙营造沉稳现代的居家氛围。",
    category: "居家空间",
    imageUrl: "/scenes/29.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/11a6eee4fdd929c9fc6843fe7b3de530.jpeg",
  },
  {
    id: 30,
    name: "法式客厅",
    description: "蓝色丝绒沙发、壁炉与雕花墙面构成法式客厅背景。",
    category: "居家空间",
    imageUrl: "/scenes/30.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-20/7e3392964fe8ee7695efa4a5b3abf40d.jpeg",
  },
  {
    id: 31,
    name: "生活化客厅",
    description: "中性色沙发、几何装饰与绿植呈现干净的现代家居感。",
    category: "居家空间",
    imageUrl: "/scenes/31.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-21/b7b6c632a14a71b500b7aad2e67f317f.jpeg",
  },
  {
    id: 32,
    name: "客厅窗帘",
    description: "灯光、窗帘与沙发局部构成留白充足的室内背景。",
    category: "居家空间",
    imageUrl: "/scenes/32.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-21/16ed6575da73f9ff0d9bfe93a3e5c4da.jpeg",
  },
  {
    id: 33,
    name: "精致客厅-暖色",
    description: "藤编与原木元素配合暖灯，适合家居和香氛产品。",
    category: "居家空间",
    imageUrl: "/scenes/33.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/d434fd32ca93f03e3c85cbed9bbd3782.jpeg",
  },
  {
    id: 34,
    name: "复古客厅",
    description: "木质边柜、复古落地灯与单人椅营造怀旧氛围。",
    category: "居家空间",
    imageUrl: "/scenes/34.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/6f830fe517197f74b0a62335bb12fd13.jpeg",
  },
  {
    id: 35,
    name: "简约客厅",
    description: "大理石台面和单人沙发组成简约而实用的工作背景。",
    category: "居家空间",
    imageUrl: "/scenes/35.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-21/2140535bbdc64ba7a7c36c3196faa3f7.jpeg",
  },
  {
    id: 36,
    name: "极简黑客厅",
    description: "长矮脚柜、黑色沙发和落地玻璃窗构成客厅区域。",
    category: "居家空间",
    imageUrl: "/scenes/36.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-22/fec48877c14545e5f1bed9a5ea350b57.jpeg",
  },
  {
    id: 37,
    name: "现代客厅",
    description: "深色柜体和整洁操作台呈现现代家居厨房质感。",
    category: "居家空间",
    imageUrl: "/scenes/37.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-21/e1b61b19b3716118b4a2a7b4a1a3e5a7.jpeg",
  },
  {
    id: 38,
    name: "温馨书房",
    description: "浅色墙面与木质桌椅结合，呈现舒适雅致的阅读空间。",
    category: "居家空间",
    imageUrl: "/scenes/38.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/82fd858ac317e045dd684398009f16de.jpeg",
  },
  {
    id: 39,
    name: "原木书房",
    description: "木质书桌、书架与窗边自然光构成专注学习环境。",
    category: "居家空间",
    imageUrl: "/scenes/39.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/9ff1599a70dfa55fab9ff9f7869389c0.jpeg",
  },
  {
    id: 40,
    name: "简约书房",
    description: "木质书桌、书架与窗边自然光，整体简约基调。",
    category: "居家空间",
    imageUrl: "/scenes/40.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-20/b7f3557c6f9e087a267b9e0ea7fd8e32.jpeg",
  },
  {
    id: 41,
    name: "厨房",
    description: "原木橱柜、白色台面与自然光呈现温暖厨房场景。",
    category: "居家空间",
    imageUrl: "/scenes/41.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/4c91868d44091a8f435721661baff1ef.jpeg",
  },
  {
    id: 42,
    name: "深灰卫浴",
    description: "深灰墙砖与玻璃隔断形成冷静利落的卫浴空间。",
    category: "居家空间",
    imageUrl: "/scenes/42.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-21/42d0584986756976f584db3b691e2bd3.jpeg",
  },
  {
    id: 43,
    name: "现代卫浴",
    description: "原木洗手台、圆形背光镜与大面积台面适合洗护展示。",
    category: "居家空间",
    imageUrl: "/scenes/43.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/17a6c07084547d4744329857b02d5b64.jpeg",
  },
  {
    id: 44,
    name: "绿植阳台",
    description: "藤编座椅、绿植和通透采光打造轻松的居家阳台。",
    category: "居家空间",
    imageUrl: "/scenes/44.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/641d46672287959ec24d6efc30e64071.jpeg",
  },
  {
    id: 45,
    name: "衣帽间",
    description: "开放式浅木收纳柜、衣架与全身镜，适合服饰类展示。",
    category: "居家空间",
    imageUrl: "/scenes/45.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/9175c898fc4117f63bc4a167a743f308.jpeg",
  },
  {
    id: 46,
    name: "现代简约卧室",
    description: "留白墙面、浅木床架与白色寝具构成简洁卧室背景。",
    category: "居家空间",
    imageUrl: "/scenes/46.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/b30ce545bbfce57a2cd1674a1f2e36aa.jpeg",
  },
  {
    id: 47,
    name: "欧式卧室",
    description: "白色床品搭配原木家具与简洁墙面，画面清新明亮。",
    category: "居家空间",
    imageUrl: "/scenes/47.jpg",
    sourceUrl:
      "https://omni-tos.fifay.cn/prod/GT/material/10000002/10000002/2026-07-23/94ae23e3a954ea677b6fb89fe071dfad.jpeg",
  },
];
