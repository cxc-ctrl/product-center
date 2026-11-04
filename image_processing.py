"""One size policy for browser uploads, Excel pictures and batch imports."""
from dataclasses import dataclass
import io
import math
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_IMAGE_BYTES = 200_000
MAX_INPUT_BYTES = 15 * 1024 * 1024
MAX_PIXELS = 48_000_000
MAX_LONG_EDGE = 2400
MAX_THUMBNAIL_BYTES = 30_000
MAX_THUMBNAIL_EDGE = 384
ALLOWED = {'JPEG': ('.jpg', 'image/jpeg'), 'PNG': ('.png', 'image/png'),
           'WEBP': ('.webp', 'image/webp'), 'GIF': ('.gif', 'image/gif')}


@dataclass
class CompressedImage:
    data: bytes
    extension: str
    mime: str
    width: int
    height: int
    original_bytes: int
    frames: int = 1

    def details(self):
        return {'original_bytes': self.original_bytes, 'stored_bytes': len(self.data),
                'width': self.width, 'height': self.height, 'frames': self.frames,
                'format': self.extension.lstrip('.'), 'limit_bytes': MAX_IMAGE_BYTES}


def _encode(frames, size, quality, durations, loop, lossless=False):
    resized = []
    for frame in frames:
        value = frame.copy()
        if value.size != size:
            value = value.resize(size, Image.Resampling.LANCZOS)
        resized.append(value)
    output = io.BytesIO()
    options = {'format': 'WEBP', 'quality': quality, 'method': 4, 'lossless': lossless}
    if len(resized) > 1:
        options.update(save_all=True, append_images=resized[1:], duration=durations, loop=loop, minimize_size=True)
    resized[0].save(output, **options)
    return output.getvalue()


def make_thumbnail(data):
    """A static preview; keep the full image's aspect ratio and alpha channel."""
    with Image.open(io.BytesIO(data)) as source:
        source.seek(0)
        image = ImageOps.exif_transpose(source).convert('RGBA' if 'A' in source.getbands() or source.info.get('transparency') is not None else 'RGB')
        image.thumbnail((MAX_THUMBNAIL_EDGE, MAX_THUMBNAIL_EDGE), Image.Resampling.LANCZOS, reducing_gap=3)
        size = image.size
        while True:
            for quality in (84, 80, 76, 70):
                encoded = _encode([image], size, quality, [100], 0)
                if len(encoded) <= MAX_THUMBNAIL_BYTES:
                    return CompressedImage(encoded, '.webp', 'image/webp', *size, len(data))
            next_size = (max(1, round(size[0] * .84)), max(1, round(size[1] * .84)))
            if next_size == size:
                raise ValueError('无法生成缩略图，请换一张图片。')
            size = next_size


def compress_image(data, *, max_input_bytes=MAX_INPUT_BYTES):
    if not data:
        raise ValueError('图片文件内容为空。')
    if len(data) > max_input_bytes:
        raise ValueError('单张原图需要在15MB以内。')
    original_bytes = len(data)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as probe:
                if probe.format not in ALLOWED:
                    raise ValueError('请使用JPG、PNG、WebP或GIF图片。')
                if probe.width * probe.height > MAX_PIXELS:
                    raise ValueError('图片像素过大，请使用4800万像素以内的图片。')
                image_format = probe.format
                probe.verify()
            with Image.open(io.BytesIO(data)) as source:
                frame_count = getattr(source, 'n_frames', 1)
                if frame_count > 600:
                    raise ValueError('动图帧数过多，请缩短后再上传。')
                orientation = source.getexif().get(274, 1)
                # Small, valid originals remain sharp and are never enlarged.
                if original_bytes <= MAX_IMAGE_BYTES and max(source.size) <= MAX_LONG_EDGE and orientation == 1:
                    source.load()
                    extension, mime = ALLOWED[image_format]
                    return CompressedImage(data, extension, mime, source.width, source.height, original_bytes, frame_count)
                frames, durations = [], []
                step = max(1, math.ceil(frame_count / 60))
                long_edge = MAX_LONG_EDGE if frame_count == 1 else min(1200, int(math.sqrt(24_000_000 / min(frame_count, 60))))
                duration = 0
                for index in range(frame_count):
                    source.seek(index)
                    if index % step == 0:
                        if frames:
                            durations.append(max(20, duration))
                        duration = 0
                        frame = ImageOps.exif_transpose(source).convert('RGBA' if 'A' in source.getbands() or source.info.get('transparency') is not None else 'RGB')
                        frame.thumbnail((long_edge, long_edge), Image.Resampling.LANCZOS, reducing_gap=3)
                        frames.append(frame.copy())
                    duration += int(source.info.get('duration', 100))
                durations.append(max(20, duration))
                loop = int(source.info.get('loop', 0))
                size = frames[0].size
                # For diagrams and label artwork, try lossless before lossy encoding.
                if len(frames) == 1 and image_format == 'PNG' and max(size) <= 1600:
                    encoded = _encode(frames, size, 100, durations, loop, lossless=True)
                    if len(encoded) <= MAX_IMAGE_BYTES:
                        return CompressedImage(encoded, '.webp', 'image/webp', *size, original_bytes)
                while True:
                    for quality in (94, 90, 86, 82):
                        encoded = _encode(frames, size, quality, durations, loop)
                        if len(encoded) <= MAX_IMAGE_BYTES:
                            return CompressedImage(encoded, '.webp', 'image/webp', *size, original_bytes, len(frames))
                    ratio = .84
                    next_size = (max(1, round(size[0] * ratio)), max(1, round(size[1] * ratio)))
                    if next_size == size:
                        raise ValueError('图片无法在200KB内清晰保存，请换一张图片。')
                    size = next_size
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombWarning, Image.DecompressionBombError) as exc:
        raise ValueError('图片已损坏或无法读取，请换一张图片。') from exc
