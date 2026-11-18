/**
 * 带图附件（V8）。
 *
 * 相册：expo-image-picker（本机 58.0.10，依据其 build/ImagePicker.types.d.ts 的真实字段）
 * 文件：expo-document-picker（原生模块，可能没被编进当前安装包 → 运行时 require + 降级）
 *
 * base64 不含 data: 前缀，直接作为 /api/send 的 images[].data 传给服务端 normalizeSendImages。
 * 两个入口都只采纳图片：服务端 /api/send 只接受 images[]，原版 fileToImageAttachment 同样只接受图片格式。
 */
import { requireOptionalNativeModule } from 'expo';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
type FileSystemModule = typeof import('expo-file-system/legacy');

function getFileSystem(): FileSystemModule | null {
  try {
    return require('expo-file-system/legacy') as FileSystemModule;
  } catch {
    return null;
  }
}

export type PickedImage = {
  name: string;
  mimeType: string;
  data: string;
  uri: string;
};

/** 相册入口。 */
export async function pickImages(): Promise<PickedImage[]> {
  if (Platform.OS === 'web') {
    // Web 预览（expo export --platform web）不弹原生图片库，返回空数组即可，
    // 不伪造图片数据；真机/模拟器由 launchImageLibraryAsync 提供。
    return [];
  }
  const permission = await ImagePicker.getMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    const requested = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!requested.granted) return [];
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    base64: true,
    quality: 0.7,
  });
  if (result.canceled || !result.assets) return [];
  return result.assets
    .filter((asset) => Boolean(asset.base64))
    .map((asset, index) => ({
      name: asset.fileName || `image-${Date.now()}-${index + 1}.jpg`,
      mimeType: asset.mimeType || 'image/jpeg',
      data: String(asset.base64),
      uri: asset.uri,
    }));
}

/** The native capability is checked before loading the picker JS module. */
export async function pickFiles(): Promise<{ images: PickedImage[]; skipped: number; unavailable: boolean }> {
  if (Platform.OS === 'web') return { images: [], skipped: 0, unavailable: false };
  if (!requireOptionalNativeModule('ExpoDocumentPicker')) return { images: [], skipped: 0, unavailable: true };
  let DocumentPicker: typeof import('expo-document-picker');
  try {
    DocumentPicker = require('expo-document-picker') as typeof import('expo-document-picker');
  } catch {
    return { images: [], skipped: 0, unavailable: true };
  }
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
  if (result.canceled || !result.assets) return { images: [], skipped: 0, unavailable: false };
  const images: PickedImage[] = [];
  let skipped = 0;
  for (const asset of result.assets) {
    if (images.length >= 4) { skipped += 1; continue; }
    const mimeType = String(asset.mimeType || '').toLowerCase();
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) || (asset.size && asset.size > 5 * 1024 * 1024)) {
      skipped += 1;
      continue;
    }
    try {
      const fileSystem = getFileSystem();
      const data = asset.base64 || (fileSystem ? await fileSystem.readAsStringAsync(asset.uri, { encoding: fileSystem.EncodingType.Base64 }) : '');
      if (!data || data.length > Math.ceil((5 * 1024 * 1024) / 3) * 4) { skipped += 1; continue; }
      images.push({ name: asset.name || `image-${images.length + 1}`, mimeType, data, uri: asset.uri });
    } catch {
      skipped += 1;
    }
  }
  return { images, skipped, unavailable: false };
}
