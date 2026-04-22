/** 组卡器卡片格式（与服务端 shared/types.ts 中 BuilderCard 字段一致） */
export type BuilderCard = {
  id: string;
  name: string;
  alias?: string;
  type: string;
  cost: string | number;
  keyword?: string;
  ability?: string;
  img?: string;
  attack?: number;
  health?: number;
};
