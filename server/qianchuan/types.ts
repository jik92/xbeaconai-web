export interface QianchuanTokenPayload {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshTokenExpiresIn: number;
  authUserId: string;
}

export interface QianchuanAdvertiserSummary {
  advertiserId: string;
  name: string;
  accountRole: string;
  status: string;
}

export interface QianchuanDeliveryInput {
  name: string;
  advertiserId: string;
  productId: string;
  awemeId: string;
  videoMaterialId: string;
  imageMaterialId?: string;
  title: string;
  budget: number;
  bid?: number;
  roiGoal?: number;
  startTime: string;
  endTime: string;
  schedule: string;
  regions: string[];
  gender: "ALL" | "MALE" | "FEMALE";
  age: string[];
  marketingGoal: string;
  optimizationGoal: string;
}

export interface QianchuanUpstreamErrorShape {
  code: string;
  message: string;
  retryable: boolean;
  requestId: string;
}

export class QianchuanUpstreamError extends Error {
  constructor(readonly detail: QianchuanUpstreamErrorShape) {
    super(detail.message);
    this.name = "QianchuanUpstreamError";
  }
}
