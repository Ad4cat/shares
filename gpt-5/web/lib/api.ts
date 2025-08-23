export interface Group {
  id: string;
  ownerId: string;
  capBytes: number;
  usedBytes: number;
  isPaid: boolean;
  paidUntil?: number;
  plan?: string;
  createdAt: number;
  expiresAt: number;
  isActive: boolean;
}

export interface Media {
  id: string;
  groupId: string;
  uploaderId: string;
  s3Key: string;
  mime: string;
  size: number;
  checksum?: string;
  displayName?: string;
  createdAt: number;
}

export interface Invite {
  token: string;
  groupId: string;
  maxJoins: number;
  attempts: number;
  expiresAt: number;
  createdAt: number;
}

export interface UploadUrlResponse {
  status: "upload" | "duplicate-in-group" | "reused-blob-no-upload";
  url?: string;
  key?: string;
  expiresIn?: number;
  existingId?: string;
}

export interface DownloadUrlResponse {
  url: string;
  expiresIn: number;
}

export interface Member {
  userId: string;
  role: "owner" | "member";
}

class ApiClient {
  private baseUrl = "/api/proxy";

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}/${endpoint}`;
    const headers = new Headers({ "Content-Type": "application/json" });
    const optHeaders = options.headers as HeadersInit | undefined;
    if (optHeaders) {
      if (optHeaders instanceof Headers) {
        optHeaders.forEach((v, k) => headers.set(k, v));
      } else if (Array.isArray(optHeaders)) {
        optHeaders.forEach(([k, v]) => headers.set(k, v));
      } else {
        Object.entries(optHeaders).forEach(([k, v]) => headers.set(k, v));
      }
    }

    const response = await fetch(url, { headers, ...options });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
  }

  // Groups
  async createGroup(): Promise<{
    id: string;
    expiresAt: number;
    members: Member[];
  }> {
    return this.request("groups", { method: "POST" });
  }

  async getActiveGroup(): Promise<{ id: string | null }> {
    return this.request("me/active-group");
  }

  async closeGroup(groupId: string): Promise<{ success: boolean }> {
    return this.request(`groups/${groupId}/close`, { method: "POST" });
  }

  async getGroup(groupId: string): Promise<{
    id: string;
    isActive: boolean;
    expiresAt: number;
    usedBytes: number;
    capBytes: number;
  }> {
    return this.request(`groups/${groupId}`);
  }

  async getGroupInvite(
    groupId: string
  ): Promise<{ invite: { token: string; expiresAt: number } | null }> {
    return this.request(`groups/${groupId}/invite`);
  }

  async getGroupMembers(groupId: string): Promise<{ members: Member[] }> {
    return this.request(`groups/${groupId}/members`);
  }

  async removeMember(
    groupId: string,
    userId: string
  ): Promise<{ success: boolean }> {
    return this.request(`groups/${groupId}/members/${userId}`, {
      method: "DELETE",
    });
  }

  // Invites
  async createInvite(data: {
    groupId: string;
    passcode: string;
    maxJoins?: number;
  }): Promise<{ token: string; expiresAt: number }> {
    return this.request("invites", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async joinGroup(data: {
    token: string;
    passcode: string;
  }): Promise<{ groupId: string }> {
    return this.request("join", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Upload
  async requestUploadUrl(data: {
    groupId: string;
    filename: string;
    mime: string;
    size: number;
    checksum: string;
  }): Promise<UploadUrlResponse> {
    return this.request("upload-url", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async commitMedia(data: {
    groupId: string;
    uploaderId: string;
    key: string;
    mime: string;
    size: number;
    checksum: string;
    displayName?: string;
    // Optional capture/timezone
    takenAt?: number; // epoch seconds (UTC)
    tzOffsetMin?: number; // minutes
    takenAtSrc?: string;
    // Optional location
    takenLatE7?: number;
    takenLonE7?: number;
    locAccuracyM?: number;
    locationSrc?: string;
    // Photo metadata
    deviceMake?: string;
    deviceModel?: string;
    fNumber?: number;
    exposureTimeSec?: number;
    focalLengthMm?: number;
    iso?: number;
    pixelWidth?: number;
    pixelHeight?: number;
    isHdr?: boolean;
    originalFileName?: string;
    orientation?: number;
    // Video metadata
    durationMs?: number;
    fps?: number;
    rotation?: number;
    videoCodec?: string;
  }): Promise<{ id: string }> {
    return this.request("media/commit", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  // Media
  async listMedia(params: {
    groupId: string;
    excludeUploaderId?: string;
  }): Promise<{ items: Media[] }> {
    const searchParams = new URLSearchParams();
    searchParams.set("groupId", params.groupId);
    if (params.excludeUploaderId) {
      searchParams.set("excludeUploaderId", params.excludeUploaderId);
    }

    return this.request(`media?${searchParams.toString()}`);
  }

  async getDownloadUrl(mediaId: string): Promise<DownloadUrlResponse> {
    return this.request(`download-url?id=${mediaId}`);
  }
}

export const apiClient = new ApiClient();
