/**
 * 带图附件（V6 §2.3 RN）。
 * 依据本机 expo-image-picker@58.0.10 的真实类型：
 *   build/ImagePicker.d.ts        → launchImageLibraryAsync(options?): Promise<ImagePickerResult>
 *   build/ImagePicker.types.d.ts  → ImagePickerAsset.base64 / mimeType / fileName / uri，
 *                                  ImagePickerOptions.mediaTypes / allowsMultipleSelection / base64 / quality
 * base64 不含 data: 前缀，直接作为 /api/send 的 images[].data 传给服务端 normalizeSendImages。
 */
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export type PickedImage = {
  name: string;
  mimeType: string;
  data: string;
  uri: string;
};

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
