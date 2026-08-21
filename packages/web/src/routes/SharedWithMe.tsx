import { Navigate } from 'react-router-dom';
import { getWorkspacePath } from '../utils/url';

export default function SharedWithMe() {
  return <Navigate to={`${getWorkspacePath()}?filter=shared-with-me`} replace />;
}
