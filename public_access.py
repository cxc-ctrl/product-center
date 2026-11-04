"""Explicit anonymous read surface. New endpoints remain private by default."""
import re

PUBLIC_READS = frozenset({
    '/api/products', '/api/warehouse-rules', '/api/categories', '/api/scenes',
    '/api/product-anomalies',
})
PUBLIC_EXPORTS = frozenset({'/api/export/warehouse', '/api/export/website'})


def public_request(path, mutation=False):
    if mutation:
        return path in PUBLIC_EXPORTS
    return path in PUBLIC_READS or bool(re.fullmatch(
        r'/(?:media/[a-f0-9]{64}\.(?:png|jpg|gif|webp)|thumbs/[a-f0-9]{64}\.webp)', path))
