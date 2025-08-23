"use client";

import { useState, useEffect, Suspense } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter, useSearchParams } from "next/navigation";
import { apiClient, Media, Member } from "@/lib/api";
import { calculateFileHash } from "@/lib/hash-worker";

function GroupPageContent() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();
  const groupId = searchParams.get("id");

  const [loadCapacity, setLoadCapacity] = useState(false);
  const [loadExpiresAt, setLoadExpiresAt] = useState(false);
  const [media, setMedia] = useState<Media[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [profileMap, setProfileMap] = useState<
    Record<string, { name: string; imageUrl: string }>
  >({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadCounter, setUploadCounter] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [inviteToken, setInviteToken] = useState("");
  const [invitePasscode, setInvitePasscode] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [excludeMyUploads, setExcludeMyUploads] = useState(false);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [usage, setUsage] = useState<{ used: number; cap: number } | null>(
    null
  );
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);

  const DEFAULT_CAP_BYTES = 100 * 1024 * 1024 * 1024; // 100GB fallback

  function formatRemaining(expireEpochSec: number): string {
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, expireEpochSec - now);
    const d = Math.floor(diff / 86400);
    const h = Math.floor((diff % 86400) / 3600);
    const m = Math.floor((diff % 3600) / 60);
    if (d > 0) return `${d}日${h}時間`;
    if (h > 0) return `${h}時間${m}分`;
    return `${m}分`;
  }

  function remainingDays(expireEpochSec: number): number {
    const now = Math.floor(Date.now() / 1000);
    const diff = Math.max(0, expireEpochSec - now);
    return Math.ceil(diff / 86400);
  }

  function toEpochSeconds(val: unknown): number | null {
    if (val == null) return null;
    if (typeof val === "number") {
      return val > 2000000000 ? Math.floor(val / 1000) : Math.floor(val);
    }
    if (typeof val === "string") {
      const num = Number(val);
      if (Number.isFinite(num)) {
        return num > 2000000000 ? Math.floor(num / 1000) : Math.floor(num);
      }
      const d = new Date(val);
      const ms = d.getTime();
      return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
    }
    return null;
  }

  useEffect(() => {
    if (!groupId) {
      router.push("/");
      return;
    }
    // loadMedia(); // 遅延読み込みに変更
    loadExistingInvite();
    loadMembers();
    // load group expiry
    (async () => {
      try {
        setLoadExpiresAt(true);
        setLoadCapacity(true);
        const g = await apiClient.getGroup(groupId);
        console.log("Group data received:", g);

        // 期限の処理
        const normalizedExpiresAt = toEpochSeconds(g.expiresAt);
        if (normalizedExpiresAt !== null) {
          setExpiresAt(normalizedExpiresAt);
          console.log("Expires at set to:", normalizedExpiresAt);
          setLoadExpiresAt(false);
        } else {
          console.warn("Could not parse expiresAt:", g.expiresAt);
          setLoadExpiresAt(false);
        }

        // 容量の処理
        if (g.usedBytes != null && g.capBytes != null) {
          setUsage({ used: g.usedBytes, cap: g.capBytes });
          console.log("Usage set:", { used: g.usedBytes, cap: g.capBytes });
          setLoadCapacity(false);
        } else {
          console.log("No usage data found");
          setLoadCapacity(false);
        }
      } catch (err) {
        console.error("Failed to load group data:", err);
        const msg = err instanceof Error ? err.message : String(err);
        console.error("Group load error details:", msg);
      }
    })();
  }, [groupId, excludeMyUploads]);

  const loadExistingInvite = async () => {
    if (!groupId) return;

    try {
      const result = await apiClient.getGroupInvite(groupId);
      if (result.invite) {
        setInviteToken(result.invite.token);
      }
    } catch {
      // No existing invite or error - ignore
      console.log("No existing invite found");
    }
  };

  const loadMembers = async () => {
    if (!groupId) return;

    console.log("[Group] Loading members for group:", groupId);
    console.log("[Group] Current user:", user?.id);

    // Check if we have initial members data in localStorage (from group creation)
    const initialMembersKey = `group-${groupId}-initial-members`;
    const initialMembersData = localStorage.getItem(initialMembersKey);

    if (initialMembersData) {
      try {
        const initialMembers = JSON.parse(initialMembersData);
        console.log(
          "[Group] Using initial members from localStorage:",
          initialMembers
        );
        setMembers(initialMembers);
        // Clean up localStorage
        localStorage.removeItem(initialMembersKey);
      } catch (e) {
        console.error("Failed to parse initial members data:", e);
      }
    }

    try {
      const result = await apiClient.getGroupMembers(groupId);
      console.log("[Group] Members loaded successfully:", result.members);
      setMembers(result.members);

      // Clerkプロフィールを取得
      const ids = Array.from(new Set(result.members.map((m) => m.userId)));
      if (ids.length > 0) {
        try {
          const res = await fetch(
            `/api/clerk/users?ids=${encodeURIComponent(ids.join(","))}`
          );
          if (res.ok) {
            const data = await res.json();
            setProfileMap(data.users || {});
          }
        } catch {}
      }
    } catch (err) {
      console.error("Failed to load members:", err);
      console.error("Error details:", err);
      // If we don't have initial members and API fails, show error
      if (!initialMembersData) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`メンバー一覧の読み込みに失敗しました: ${msg}`);
      }
    }
  };

  const isOwner = () => {
    return members.find((m) => m.userId === user?.id)?.role === "owner";
  };

  const handleRemoveMember = async (targetUserId: string) => {
    if (!groupId || !user?.id) return;

    if (!window.confirm("このメンバーをグループから削除しますか？")) {
      return;
    }

    try {
      await apiClient.removeMember(groupId, targetUserId);
      loadMembers(); // Reload members list
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`メンバーの削除に失敗しました: ${msg}`);
    }
  };

  const handleDeleteGroup = async () => {
    if (!groupId || !user?.id) return;

    if (
      !window.confirm(
        "本当にこのグループを削除しますか？この操作は取り消せません。"
      )
    ) {
      return;
    }

    try {
      await apiClient.closeGroup(groupId);
      router.push("/");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`グループの削除に失敗しました: ${msg}`);
    }
  };

  const loadMedia = async () => {
    if (!groupId) return;

    setMediaLoading(true);
    setError("");

    try {
      const result = await apiClient.listMedia({
        groupId,
        excludeUploaderId: excludeMyUploads ? user?.id : undefined,
      });
      setMedia(result.items);
      setMediaLoaded(true);

      // Fallback: グループ詳細APIが取得できない場合でも、メディア合計から使用量を概算
      if (!usage) {
        const totalBytes = result.items.reduce(
          (sum, item) => sum + (item.size || 0),
          0
        );
        setUsage({ used: totalBytes, cap: DEFAULT_CAP_BYTES });
      }

      // Fallback: /groups/:id が404等で期限が取得できない場合、最古のメディア作成時刻 + 7日 を期限と推定
      if (expiresAt == null && result.items.length > 0) {
        const minCreatedSec = result.items
          .map((it) =>
            toEpochSeconds(
              (it as unknown as { createdAt?: number | string | Date })
                .createdAt
            )
          )
          .filter(
            (v): v is number => typeof v === "number" && Number.isFinite(v)
          )
          .reduce<number | null>(
            (min, sec) => (min == null || sec < min ? sec : min),
            null
          );
        if (minCreatedSec != null) {
          setExpiresAt(minCreatedSec + 7 * 24 * 60 * 60);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || "メディアの読み込みに失敗しました");
    } finally {
      setMediaLoading(false);
    }
  };

  const handleFileUpload = async (files: FileList) => {
    if (!groupId || !user?.id) return;

    setIsLoading(true);
    setError("");

    const filesArray = Array.from(files);
    setUploadCounter({ done: 0, total: filesArray.length });

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const requestUploadUrlWithRetry = async (
      params: {
        groupId: string;
        filename: string;
        mime: string;
        size: number;
        checksum: string;
      },
      retries = 3,
      baseDelayMs = 1500
    ) => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          return await apiClient.requestUploadUrl(params);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const isRateLimited = /429|Too many upload requests/i.test(msg);
          if (isRateLimited && attempt < retries) {
            const delay = baseDelayMs * Math.pow(2, attempt);
            await sleep(delay);
            continue;
          }
          throw e;
        }
      }
      throw new Error("unexpected");
    };

    const incrementDone = () =>
      setUploadCounter((prev) =>
        prev ? { ...prev, done: prev.done + 1 } : prev
      );

    for (const file of filesArray) {
      try {
        // Calculate file hash
        const checksum = await calculateFileHash(file);

        // Extract metadata (best effort)
        type UploadMetadata = {
          originalFileName?: string;
          takenAt?: number;
          takenAtSrc?: string;
          tzOffsetMin?: number;
          takenLatE7?: number;
          takenLonE7?: number;
          locationSrc?: string;
          deviceMake?: string;
          deviceModel?: string;
          fNumber?: number;
          exposureTimeSec?: number;
          focalLengthMm?: number;
          iso?: number;
          pixelWidth?: number;
          pixelHeight?: number;
          orientation?: number;
          durationMs?: number;
        };
        const meta: UploadMetadata = { originalFileName: file.name };
        try {
          if (file.type.startsWith("image/")) {
            const { default: exifr } = await import("exifr");
            const exif = await exifr.parse(file, {
              gps: true,
              tiff: true,
              ifd0: true,
              exif: true,
            });
            if (exif) {
              if (exif.DateTimeOriginal || exif.CreateDate) {
                const d = new Date(
                  (exif.DateTimeOriginal || exif.CreateDate).toString()
                );
                if (!Number.isNaN(d.getTime())) {
                  meta.takenAt = Math.floor(d.getTime() / 1000);
                  meta.takenAtSrc = "exif";
                  meta.tzOffsetMin = -new Date().getTimezoneOffset();
                }
              }
              if (
                typeof exif.latitude === "number" &&
                typeof exif.longitude === "number"
              ) {
                meta.takenLatE7 = Math.round(exif.latitude * 1e7);
                meta.takenLonE7 = Math.round(exif.longitude * 1e7);
                meta.locationSrc = "exif";
              }
              if (exif.Make) meta.deviceMake = exif.Make;
              if (exif.Model) meta.deviceModel = exif.Model;
              if (exif.FNumber) meta.fNumber = Number(exif.FNumber);
              if (exif.ExposureTime)
                meta.exposureTimeSec = Number(exif.ExposureTime);
              if (exif.FocalLength)
                meta.focalLengthMm = Number(exif.FocalLength);
              if (exif.ISO) meta.iso = Number(exif.ISO);
              if (exif.ExifImageWidth)
                meta.pixelWidth = Number(exif.ExifImageWidth);
              if (exif.ExifImageHeight)
                meta.pixelHeight = Number(exif.ExifImageHeight);
              if (typeof exif.Orientation === "number")
                meta.orientation = exif.Orientation;
            }
          } else if (file.type.startsWith("video/")) {
            meta.takenAt = Math.floor(file.lastModified / 1000);
            meta.takenAtSrc = "file";
            meta.tzOffsetMin = -new Date().getTimezoneOffset();
            const url = URL.createObjectURL(file);
            try {
              const videoEl = document.createElement("video");
              videoEl.preload = "metadata";
              videoEl.src = url;
              await new Promise<void>((resolve) => {
                const onLoaded = () => {
                  meta.pixelWidth = videoEl.videoWidth || undefined;
                  meta.pixelHeight = videoEl.videoHeight || undefined;
                  meta.durationMs = Number.isFinite(videoEl.duration)
                    ? Math.round(videoEl.duration * 1000)
                    : undefined;
                  resolve();
                };
                const onError = () => resolve();
                videoEl.addEventListener("loadedmetadata", onLoaded, {
                  once: true,
                });
                videoEl.addEventListener("error", onError, { once: true });
              });
            } finally {
              URL.revokeObjectURL(url);
            }
          }
        } catch {}

        // Request upload URL
        const uploadResult = await requestUploadUrlWithRetry({
          groupId,
          filename: file.name,
          mime: file.type,
          size: file.size,
          checksum,
        });

        if (uploadResult.status === "duplicate-in-group") {
          setError(`${file.name}はすでにギャラリーに存在します。`);
          incrementDone();
          continue;
        }

        if (uploadResult.status === "reused-blob-no-upload") {
          // Commit metadata without upload
          await apiClient.commitMedia({
            groupId,
            uploaderId: user.id,
            key: uploadResult.key!,
            mime: file.type,
            size: file.size,
            checksum,
            displayName: file.name,
            ...meta,
          });
          incrementDone();
          continue;
        }

        if (uploadResult.status === "upload") {
          // Upload file to S3
          const response = await fetch(uploadResult.url!, {
            method: "PUT",
            body: file,
          });

          if (!response.ok) {
            throw new Error("Upload failed");
          }

          // Commit metadata
          await apiClient.commitMedia({
            groupId,
            uploaderId: user.id,
            key: uploadResult.key!,
            mime: file.type,
            size: file.size,
            checksum,
            displayName: file.name,
            ...meta,
          });
          incrementDone();
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`ファイル ${file.name} のアップロードに失敗しました: ${msg}`);
        incrementDone();
      }
    }

    setIsLoading(false);
    setUploadCounter(null);
    if (mediaLoaded) {
      loadMedia(); // Only reload if media was already loaded
    }
  };

  const handleDownload = async (mediaItem: Media) => {
    try {
      const result = await apiClient.getDownloadUrl(mediaItem.id);
      const link = document.createElement("a");
      link.href = result.url;
      link.download = mediaItem.displayName || "download";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      setError("ダウンロードに失敗しました");
    }
  };

  const handleBulkDownload = async () => {
    if (!groupId) return;

    try {
      const result = await apiClient.listMedia({
        groupId,
        excludeUploaderId: excludeMyUploads ? user?.id : undefined,
      });

      // Download files with concurrency limit
      const concurrency = 3;
      const chunks = [];
      for (let i = 0; i < result.items.length; i += concurrency) {
        chunks.push(result.items.slice(i, i + concurrency));
      }

      for (const chunk of chunks) {
        await Promise.all(
          chunk.map(async (item) => {
            try {
              const downloadResult = await apiClient.getDownloadUrl(item.id);
              const link = document.createElement("a");
              link.href = downloadResult.url;
              link.download = item.displayName || "download";
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            } catch (error) {
              console.error(`Failed to download ${item.displayName}:`, error);
            }
          })
        );
      }
    } catch {
      setError("一括ダウンロードに失敗しました");
    }
  };

  const handleCreateInvite = async () => {
    if (!groupId) return;

    try {
      const result = await apiClient.createInvite({
        groupId,
        passcode: invitePasscode,
      });
      setInviteToken(result.token);
      setInvitePasscode("");
      setShowInviteForm(false);
    } catch {
      setError("招待の作成に失敗しました");
    }
  };

  const copyInviteLink = () => {
    const link = `${window.location.origin}/join?token=${inviteToken}`;
    navigator.clipboard.writeText(link);
    alert("招待リンクをコピーしました");
  };

  const shareToLine = () => {
    const link = `${window.location.origin}/join?token=${inviteToken}`;
    const text = encodeURIComponent(
      `TripShareグループに参加してください！ ${link}`
    );
    const lineUrl = `https://line.me/R/msg/text/?${text}`;
    window.open(lineUrl, "_blank");
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    router.push("/");
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-lg p-6">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-baseline space-x-3">
              <h1 id="title" className="text-2xl font-bold text-gray-900">
                グループ
              </h1>
              {loadExpiresAt ? (
                <span className="text-sm text-gray-600">
                  期限: 読み込み中...
                </span>
              ) : expiresAt !== null ? (
                <span className="text-sm text-gray-600">
                  期限: {remainingDays(expiresAt)}日
                </span>
              ) : (
                <span className="text-sm text-red-600">
                  グループの期限を取得できませんでした。
                </span>
              )}
            </div>
            <div className="flex space-x-2">
              {isOwner() && (
                <button
                  onClick={handleDeleteGroup}
                  className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700"
                >
                  グループを削除
                </button>
              )}
              <button
                onClick={() => router.push("/")}
                className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700"
              >
                戻る
              </button>
            </div>
          </div>

          {/* Upload Section */}
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-4">
              ファイルをアップロード
            </h2>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
              <input
                type="file"
                multiple
                accept="image/*,video/*"
                onChange={(e) =>
                  e.target.files && handleFileUpload(e.target.files)
                }
                disabled={isLoading}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="cursor-pointer bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {isLoading ? "アップロード中..." : "ファイルを選択"}
              </label>
            </div>

            {/* Upload Progress (compact) */}
            {uploadCounter && (
              <div className="mt-4 text-sm text-gray-700">
                {uploadCounter.done}/{uploadCounter.total}枚
              </div>
            )}
          </div>

          {/* Invite Section - Owner Only */}
          {isOwner() && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold mb-4">メンバーを招待</h2>
              {!showInviteForm && !inviteToken ? (
                <button
                  onClick={() => setShowInviteForm(true)}
                  className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700"
                >
                  招待を作成
                </button>
              ) : showInviteForm ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      パスコード
                    </label>
                    <input
                      type="text"
                      value={invitePasscode}
                      onChange={(e) => setInvitePasscode(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      placeholder="パスコードを入力"
                    />
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={handleCreateInvite}
                      className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700"
                    >
                      作成
                    </button>
                    <button
                      onClick={() => setShowInviteForm(false)}
                      className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700"
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-gray-100 p-4 rounded-md">
                    <p className="text-sm text-gray-600 mb-2">招待リンク:</p>
                    <p className="font-mono text-sm break-all">
                      {`${window.location.origin}/join?token=${inviteToken}`}
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={copyInviteLink}
                      className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
                    >
                      リンクをコピー
                    </button>
                    <button
                      onClick={shareToLine}
                      className="bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600 flex items-center space-x-1"
                    >
                      <span>LINEで共有</span>
                    </button>
                    <button
                      onClick={() => setInviteToken("")}
                      className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700"
                    >
                      閉じる
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Invite Share - Non Owner */}
          {!isOwner() && inviteToken && (
            <div className="mb-8">
              <h2 className="text-lg font-semibold mb-4">招待を共有</h2>
              <div className="space-y-4">
                <div className="bg-gray-100 p-4 rounded-md">
                  <p className="text-sm text-gray-600 mb-2">招待リンク:</p>
                  <p className="font-mono text-sm break-all">
                    {`${window.location.origin}/join?token=${inviteToken}`}
                  </p>
                </div>
                <div className="flex space-x-2">
                  <button
                    onClick={copyInviteLink}
                    className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700"
                  >
                    リンクをコピー
                  </button>
                  <button
                    onClick={shareToLine}
                    className="bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600 flex items-center space-x-1"
                  >
                    <span>LINEで共有</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Members Section */}
          <div className="mb-8">
            <h2 className="text-lg font-semibold mb-4">参加者一覧</h2>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="space-y-2">
                {members.map((member) => (
                  <div
                    key={member.userId}
                    className="flex items-center justify-between py-2 px-3 bg-white rounded-md"
                  >
                    <div className="flex items-center space-x-3">
                      {profileMap[member.userId]?.imageUrl ? (
                        <img
                          src={profileMap[member.userId].imageUrl}
                          alt={profileMap[member.userId].name}
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-blue-600">
                            {member.userId.substring(0, 2).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {member.userId === user?.id
                            ? "あなた"
                            : profileMap[member.userId]?.name ||
                              `ユーザー ${member.userId.substring(0, 8)}`}
                        </p>
                        <p className="text-xs text-gray-500">
                          {member.role === "owner" ? "オーナー" : "メンバー"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {member.role === "owner" && (
                        <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full">
                          👑 オーナー
                        </span>
                      )}
                      {isOwner() &&
                        member.role !== "owner" &&
                        member.userId !== user?.id && (
                          <button
                            onClick={() => handleRemoveMember(member.userId)}
                            className="bg-red-500 text-white text-xs px-2 py-1 rounded hover:bg-red-600"
                          >
                            削除
                          </button>
                        )}
                    </div>
                  </div>
                ))}
              </div>
              {members.length === 0 && (
                <div className="text-center text-gray-500 py-4">
                  参加者情報を読み込み中...
                </div>
              )}
            </div>
          </div>

          {/* Gallery Section */}
          <div>
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-lg font-semibold">ギャラリー</h2>
                {loadCapacity ? (
                  <span className="text-sm text-gray-600">
                    容量: 読み込み中...
                  </span>
                ) : usage ? (
                  <div className="text-sm text-gray-600">
                    容量: {Math.round((usage.used / usage.cap) * 100)}% (
                    {Math.round(usage.used / 1073741824)}GB /{" "}
                    {Math.round(usage.cap / 1073741824)}GB)
                  </div>
                ) : (
                  <div className="text-sm text-red-600">
                    Error:容量が読み込めませんでした。
                  </div>
                )}
              </div>
              <div className="flex items-center space-x-4">
                {!mediaLoaded && (
                  <button
                    onClick={loadMedia}
                    disabled={mediaLoading}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {mediaLoading ? "読み込み中..." : "ギャラリーを読み込む"}
                  </button>
                )}

                {mediaLoaded && (
                  <>
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={excludeMyUploads}
                        onChange={(e) => {
                          setExcludeMyUploads(e.target.checked);
                          loadMedia(); // Re-load media with new filter
                        }}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-600">
                        自分のアップロードを除外
                      </span>
                    </label>

                    <button
                      onClick={handleBulkDownload}
                      className="bg-purple-600 text-white px-4 py-2 rounded-md hover:bg-purple-700"
                    >
                      一括ダウンロード
                    </button>

                    <button
                      onClick={loadMedia}
                      disabled={mediaLoading}
                      className="bg-gray-500 text-white px-4 py-2 rounded-md hover:bg-gray-600 disabled:opacity-50"
                    >
                      {mediaLoading ? "更新中..." : "更新"}
                    </button>
                  </>
                )}
              </div>
            </div>

            {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

            {mediaLoaded ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {media.map((item) => (
                  <div key={item.id} className="bg-gray-100 rounded-lg p-4">
                    <div className="aspect-square bg-gray-200 rounded-lg mb-2 flex items-center justify-center">
                      {item.mime.startsWith("image/") ? (
                        <img
                          src={`/api/proxy/download-url?id=${item.id}`}
                          alt={item.displayName || "Image"}
                          className="w-full h-full object-cover rounded-lg"
                        />
                      ) : (
                        <video
                          src={`/api/proxy/download-url?id=${item.id}`}
                          className="w-full h-full object-cover rounded-lg"
                          muted
                          playsInline
                          preload="metadata"
                          onLoadedMetadata={(e) => {
                            const v = e.currentTarget;
                            v.pause();
                            v.currentTime = Math.min(
                              0.1,
                              (v.duration || 0) * 0.05
                            );
                          }}
                        />
                      )}
                    </div>
                    <p className="text-sm font-medium truncate mb-1">
                      {item.displayName || "Unknown"}
                    </p>
                    <p className="text-xs text-gray-500 mb-2">
                      {(item.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                    <button
                      onClick={() => handleDownload(item)}
                      className="w-full bg-blue-600 text-white text-sm py-1 px-2 rounded hover:bg-blue-700"
                    >
                      ダウンロード
                    </button>
                  </div>
                ))}

                {media.length === 0 && (
                  <div className="col-span-full text-center text-gray-500 py-8">
                    まだファイルがアップロードされていません
                  </div>
                )}
              </div>
            ) : (
              !mediaLoading && (
                <div className="text-center text-gray-500 py-8">
                  「ギャラリーを読み込む」ボタンをクリックして、アップロードされたファイルを表示してください
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GroupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">読み込み中...</p>
          </div>
        </div>
      }
    >
      <GroupPageContent />
    </Suspense>
  );
}
