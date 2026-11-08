/**
 * 带图附件（V8）。
 *
 * 相册：expo-image-picker（本机 58.0.10，依据其 build/ImagePicker.types.d.ts 的真实字段）
 * 文件：expo-document-picker（原生模块，可能没被编进当前安装包 → 运行时 require + 降级）
 *
 * base64 不含 data: 前缀，直接作为 /api/send 的 images[].data 传给服务端 normalizeSendImages。
 * 两个入口都只采纳图片：服务端 /api/send 只接受 images[]，原版 fileToImageAttachment 同样只接受图片格式。
 */
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

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

/**
 * 「文件」入口：打开系统文件浏览器（对齐原版「文件浏览」accept 任意类型的语义）。
 *
 * 关键：这里用**运行时 require** 而不是顶层静态 import。
 * expo-document-picker 是原生模块；若安装包没有把它的 native module 编进去
 * （例如只热替换了 JS bundle），顶层 import 会在模块加载阶段就抛
 * "Cannot find native module"，把整个页面带崩，try/catch 也救不回来。
 * 放到 try 里 require，才能优雅降级成 unavailable。
 */
export async function pickFiles(): Promise<{ images: PickedImage[]; skipped: number; unavailable: boolean }> {
  if (Platform.OS === 'web') return { images: [], skipped: 0, unavailable: false };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const DocumentPicker = require('expo-document-picker') as typeof import('expo-document-picker');
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      multiple: true,
      base64: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets) return { images: [], skipped: 0, unavailable: false };
    const all = result.assets;
    const images = all
      .filter((asset) => String(asset.mimeType || '').startsWith('image/') && Boolean(asset.base64))
      .map((asset, index) => ({
        name: asset.name || `file-${Date.now()}-${index + 1}.png`,
        mimeType: asset.mimeType || 'image/png',
        data: String(asset.base64),
        uri: asset.uri,
      }));
    return { images, skipped: all.length - images.length, unavailable: false };
  } catch {
    return { images: [], skipped: 0, unavailable: true };
  }
}
