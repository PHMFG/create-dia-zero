import Markdown, {type Components} from 'react-markdown';
import {ExternalLink} from 'lucide-react';

const components:Components={
  a:({children,node:_,...props})=><a {...props} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={11}/></a>,
};

export default function RichText({children}:{children:string}) {
  return <Markdown components={components}>{children}</Markdown>;
}
