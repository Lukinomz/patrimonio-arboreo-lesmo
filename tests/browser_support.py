"""Browser helpers: Admin authentication is replaced only in local test responses."""
import pathlib
import re
from urllib.parse import urlparse

ROOT = pathlib.Path(__file__).resolve().parents[1]
ADMIN_TEST = 'test-only-admin-login'


def mock_admin_login(context):
    def serve(route):
        assert urlparse(route.request.url).hostname in ['127.0.0.1', 'localhost']
        source = (ROOT / 'admin-ui.js').read_text()
        # Substitute the authentication condition without extracting or using its value.
        source, count = re.subn(
            r"if \(\$\('adminPassword'\)\.value !== '[^']*'\)",
            "if ($('adminPassword').value !== '" + ADMIN_TEST + "')",
            source,
        )
        assert count == 1
        route.fulfill(status=200, content_type='application/javascript', body=source)
    context.route('**/admin-ui.js*', serve)


def open_archive(page, photos=False):
    page.evaluate("panel=>openAdminArchive(panel)", 'photos' if photos else 'archive')
    if page.locator('#adminLogin').is_visible():
        page.locator('#adminPassword').fill(ADMIN_TEST)
        page.locator('#adminLoginButton').click()
    page.locator('#adminArchivePanel').wait_for(state='visible')

