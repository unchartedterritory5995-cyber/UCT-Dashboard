"""Post-engine-run cache invalidation — overlay writes take effect immediately."""
import logging
_logger = logging.getLogger(__name__)

def post_engine_run():
    for mod, fn in (("api.services.groups", "invalidate_sizes"),
                    ("api.services.theme_performance", "invalidate_memory_cache"),
                    ("api.services.theme_index", "invalidate_cache")):
        try:
            m = __import__(mod, fromlist=[fn])
            getattr(m, fn)()
        except Exception as e:
            _logger.debug("invalidate %s.%s skipped: %s", mod, fn, e)
